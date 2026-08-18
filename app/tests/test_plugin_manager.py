import sys
import unittest
from types import ModuleType

from services.plugin_manager import _deactivate_plugin_runtime, _plugin_package_name


class PluginManagerTests(unittest.TestCase):
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
