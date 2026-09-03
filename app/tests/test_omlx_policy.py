from services.omlx_policy import GIB, recommend_omlx_cache_sizes, recommend_omlx_memory_guard


def test_recommends_omlx_cache_sizes_by_unified_memory():
    assert recommend_omlx_cache_sizes(8 * GIB) == ("4GB", "1GB")
    assert recommend_omlx_cache_sizes(16 * GIB) == ("6GB", "2GB")
    assert recommend_omlx_cache_sizes(24 * GIB) == ("10GB", "4GB")
    assert recommend_omlx_cache_sizes(32 * GIB) == ("20GB", "8GB")


def test_recommends_default_omlx_cache_sizes_when_memory_is_unknown():
    assert recommend_omlx_cache_sizes(0) == ("10GB", "4GB")


def test_recommends_aggressive_guard_only_with_at_least_24gb():
    assert recommend_omlx_memory_guard(16 * GIB) == "balanced"
    assert recommend_omlx_memory_guard(24 * GIB) == "aggressive"
