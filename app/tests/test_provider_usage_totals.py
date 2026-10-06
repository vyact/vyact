from services.llm.providers import _accumulate_openai_usage


def test_untimed_tool_rounds_accumulate_all_token_categories():
    usage = {}
    for prompt, output, cache in [(100, 10, 80), (200, 20, 100)]:
        _accumulate_openai_usage(usage, {
            'prompt_tokens': prompt, 'completion_tokens': output,
            'prompt_tokens_details': {'cached_tokens': cache},
        })
    assert usage == {'prompt_tokens': 300, 'completion_tokens': 30, 'cached_tokens': 180}
    _accumulate_openai_usage(usage, {})
    assert usage['prompt_tokens'] == 300
    assert usage['completion_tokens'] == 30


def test_mixed_timed_and_untimed_rounds_preserve_totals_and_timed_speed():
    usage = {}
    _accumulate_openai_usage(usage, {'prompt_tokens': 100, 'completion_tokens': 10})
    _accumulate_openai_usage(usage, {
        'prompt_tokens': 200, 'completion_tokens': 20,
        'prompt_eval_duration': 2, 'generation_duration': 1,
    })
    assert usage['prompt_tokens'] == 300
    assert usage['completion_tokens'] == 30
    assert usage['prompt_tokens_per_second'] == 100
    assert usage['completion_tokens_per_second'] == 20
    _accumulate_openai_usage(usage, {'prompt_tokens': 50, 'completion_tokens': 5})
    assert usage['prompt_tokens'] == 350
    assert usage['completion_tokens'] == 35
