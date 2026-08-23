import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType

from services.plugin_manager import (
    _build_plugin_frontend_url,
    _deactivate_plugin_runtime,
    _plugin_package_name,
)


class PluginManagerTests(unittest.TestCase):
    def test_frontend_url_changes_when_bundle_content_changes(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            plugin_dir = Path(temporary_directory)
            frontend_file = plugin_dir / "frontend" / "dist" / "index.js"
            frontend_file.parent.mkdir(parents=True)
            frontend_file.write_text("export default 'first';", encoding="utf-8")

            first_url = _build_plugin_frontend_url(
                "com.vyact.test",
                plugin_dir,
                "frontend/dist/index.js",
            )
            frontend_file.write_text("export default 'second';", encoding="utf-8")
            second_url = _build_plugin_frontend_url(
                "com.vyact.test",
                plugin_dir,
                "frontend/dist/index.js",
            )

            self.assertRegex(
                first_url or "",
                r"^/api/plugins/com\.vyact\.test/frontend/index\.js\?v=[0-9a-f]{12}$",
            )
            self.assertNotEqual(first_url, second_url)

    def test_deactivate_removes_plugin_package_and_submodules(self):
        plugin_id = "com.vyact.naver-news"
        package_name = _plugin_package_name(plugin_id)
        unrelated_module_name = f"{package_name}_other.plugin"
        sys.modules[package_name] = ModuleType(package_name)
        sys.modules[f"{package_name}.plugin"] = ModuleType(f"{package_name}.plugin")
        sys.modules[f"{package_name}.naver_news_search"] = ModuleType(
            f"{package_name}.naver_news_search"
        )
        sys.modules[unrelated_module_name] = ModuleType(unrelated_module_name)

        try:
            _deactivate_plugin_runtime(plugin_id, {})

            self.assertNotIn(package_name, sys.modules)
            self.assertNotIn(f"{package_name}.plugin", sys.modules)
            self.assertNotIn(f"{package_name}.naver_news_search", sys.modules)
            self.assertIn(unrelated_module_name, sys.modules)
        finally:
            sys.modules.pop(unrelated_module_name, None)


if __name__ == "__main__":
    unittest.main()
