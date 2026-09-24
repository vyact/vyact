import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.code_tools import _git_diff, _install_dependencies, _list_tasks, _node_package_manager, _project_venv_python, _run_command, _run_task, current_code_folders
from services.tool_approval import get_tool_risk, requires_approval


class CodeInstallDependenciesTests(unittest.IsolatedAsyncioTestCase):
    async def test_command_runner_handles_working_directory_with_spaces(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "project with spaces"
            project.mkdir()
            result = _run_command([sys.executable, "-c", "print('installed')"], str(project))
            self.assertIn("installed", result)
            self.assertIn("Success", result)

    async def test_failed_command_is_reported_as_tool_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            result = _run_command([sys.executable, "-c", "import sys; print('check failed'); sys.exit(2)"], directory)
            payload = json.loads(result)
            self.assertIs(payload["ok"], False)
            self.assertIn("check failed", payload["error"])

    async def test_git_diff_preserves_first_command_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            token = current_code_folders.set({"project": directory})
            try:
                with patch("services.code_tools._run_command", return_value=json.dumps({"ok": False, "error": "git failed"})) as run:
                    result = await _git_diff.__wrapped__("project")
            finally:
                current_code_folders.reset(token)
            self.assertEqual(json.loads(result)["error"], "git failed")
            run.assert_called_once()

    async def test_git_diff_preserves_second_command_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            token = current_code_folders.set({"project": directory})
            try:
                with patch("services.code_tools._run_command", side_effect=["✅ Success: git diff --stat", json.dumps({"ok": False, "error": "diff failed"})]) as run:
                    result = await _git_diff.__wrapped__("project")
            finally:
                current_code_folders.reset(token)
            self.assertEqual(json.loads(result)["error"], "diff failed")
            self.assertEqual(run.call_count, 2)

    async def test_detects_lockfile_manager_and_uses_fixed_install_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / "project with spaces"
            project.mkdir()
            (project / "package.json").write_text(json.dumps({"dependencies": {"left-pad": "1.3.0"}}), encoding="utf-8")
            (project / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n", encoding="utf-8")
            token = current_code_folders.set({"project": str(root)})
            try:
                with patch("services.code_tools.shutil.which", return_value="/usr/bin/pnpm"), patch("services.code_tools._run_command", return_value="installed") as run:
                    result = await _install_dependencies.__wrapped__("project", "project with spaces")
            finally:
                current_code_folders.reset(token)

            self.assertEqual(result, "installed")
            run.assert_called_once_with(["pnpm", "install"], str(project.resolve()), 300)

    async def test_corepack_fallback_for_pnpm(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text('{"packageManager":"pnpm@10.0.0"}', encoding="utf-8")
            token = current_code_folders.set({"project": str(root)})
            try:
                with patch("services.code_tools.shutil.which", side_effect=lambda name: "/usr/bin/corepack" if name == "corepack" else None), patch("services.code_tools._run_command", return_value="installed") as run:
                    result = await _install_dependencies.__wrapped__("project")
            finally:
                current_code_folders.reset(token)

            self.assertEqual(result, "installed")
            run.assert_called_once_with(["corepack", "pnpm", "install"], str(root.resolve()), 300)

    async def test_defaults_to_npm_without_lockfile(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text("{}", encoding="utf-8")
            self.assertEqual(_node_package_manager(root), ("npm", None))

    async def test_supported_lockfiles_select_their_package_managers(self):
        for lockfile, expected in (
            ("package-lock.json", "npm"),
            ("pnpm-lock.yaml", "pnpm"),
            ("yarn.lock", "yarn"),
            ("bun.lock", "bun"),
        ):
            with self.subTest(lockfile=lockfile), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "package.json").write_text("{}", encoding="utf-8")
                (root / lockfile).write_text("", encoding="utf-8")
                self.assertEqual(_node_package_manager(root), (expected, None))

    async def test_conflicting_package_manager_blocks_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text('{"packageManager":"yarn@4.0.0"}', encoding="utf-8")
            (root / "package-lock.json").write_text("{}", encoding="utf-8")
            manager, error = _node_package_manager(root)
            self.assertIsNone(manager)
            self.assertIn("different package managers", error)

    async def test_outside_folder_and_missing_manifest_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            root.mkdir()
            token = current_code_folders.set({"project": str(root)})
            try:
                with patch("services.code_tools._run_command") as run:
                    outside = await _install_dependencies.__wrapped__("project", "../")
                    missing = await _install_dependencies.__wrapped__("project")
            finally:
                current_code_folders.reset(token)

            self.assertIn("Not found", outside)
            self.assertIn("package.json", missing)
            run.assert_not_called()

    async def test_install_tool_requires_default_approval(self):
        self.assertEqual(get_tool_risk("code_install_dependencies"), "sensitive")
        self.assertTrue(requires_approval("code_install_dependencies", "risky_only"))

    async def test_python_install_uses_project_venv_and_selected_requirements(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / "project with spaces"
            project.mkdir()
            requirements = project / "requirements-test.txt"
            requirements.write_text("pytest==8.0.0\n", encoding="utf-8")
            environment = project / ".venv"
            python = _project_venv_python(environment)

            def run(command, cwd, timeout):
                if command[1:3] == ["-m", "venv"]:
                    python.parent.mkdir(parents=True)
                    python.touch()
                    (environment / "pyvenv.cfg").touch()
                return "✅ Success"

            token = current_code_folders.set({"project": str(root)})
            try:
                with patch("services.code_tools._run_command", side_effect=run) as command_runner:
                    result = await _install_dependencies.__wrapped__("project", "project with spaces", "requirements-test.txt")
            finally:
                current_code_folders.reset(token)

            self.assertEqual(result, "✅ Success")
            self.assertEqual(command_runner.call_count, 2)
            self.assertEqual(command_runner.call_args.args, (
                [str(_project_venv_python(project.resolve() / ".venv")), "-m", "pip", "install", "-r", str(requirements.resolve())],
                str(project.resolve()), 300,
            ))

    async def test_python_install_rejects_ambiguous_or_escaping_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            root.mkdir()
            (root / "package.json").write_text("{}", encoding="utf-8")
            (root / "requirements.txt").write_text("pytest\n", encoding="utf-8")
            token = current_code_folders.set({"project": str(root)})
            try:
                with patch("services.code_tools._run_command") as run:
                    ambiguous = await _install_dependencies.__wrapped__("project")
                    outside = await _install_dependencies.__wrapped__("project", dependency_file="../requirements.txt")
                    wrong_type = await _install_dependencies.__wrapped__("project", dependency_file="setup.py")
            finally:
                current_code_folders.reset(token)
            self.assertIn("dependency_file", ambiguous)
            self.assertIn("Invalid", outside)
            self.assertIn("Invalid", wrong_type)
            run.assert_not_called()

    @unittest.skipIf(os.name == "nt", "Creating directory symlinks requires Windows developer mode")
    async def test_existing_venv_must_not_be_symlink_or_incomplete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            root.mkdir()
            (root / "requirements.txt").write_text("pytest\n", encoding="utf-8")
            outside = Path(directory) / "outside"
            outside.mkdir()
            (root / ".venv").symlink_to(outside, target_is_directory=True)
            token = current_code_folders.set({"project": str(root)})
            try:
                with patch("services.code_tools._run_command") as run:
                    result = await _install_dependencies.__wrapped__("project")
            finally:
                current_code_folders.reset(token)
            self.assertIn("Invalid", result)
            run.assert_not_called()

    async def test_venv_python_paths_cover_windows_and_unix(self):
        environment = Path("project") / ".venv"
        self.assertEqual(_project_venv_python(environment, "nt"), environment / "Scripts/python.exe")
        self.assertEqual(_project_venv_python(environment, "posix"), environment / "bin/python")

    async def test_requirements_only_project_runs_checks_in_its_venv(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory) / "project"
            project.mkdir()
            (project / "requirements.txt").write_text("pytest\n", encoding="utf-8")
            environment = project / ".venv"
            python = _project_venv_python(environment)
            python.parent.mkdir(parents=True)
            python.touch()
            (environment / "pyvenv.cfg").touch()
            token = current_code_folders.set({"project": str(project)})
            try:
                tasks = await _list_tasks.__wrapped__("project")
                with patch("services.code_tools._run_command", return_value="✅ Success") as run:
                    result = await _run_task.__wrapped__("project", ".", "python:test")
            finally:
                current_code_folders.reset(token)
            self.assertIn("python:test", tasks)
            self.assertIn("python:compile", tasks)
            self.assertEqual(result, "✅ Success")
            run.assert_called_once_with([str(python.resolve()), "-m", "pytest"], str(project.resolve()), timeout=120)
