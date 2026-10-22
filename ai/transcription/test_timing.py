from timing import spread_words, words_from_segments

def test_spread_by_char_length():
    assert spread_words("ano ba yan", 10.0, 11.0) == [
        {"text": "ano", "start": 10.0, "end": 10.375}, {"text": "ba", "start": 10.375, "end": 10.625}, {"text": "yan", "start": 10.625, "end": 11.0}]

def test_blank_text_yields_nothing():
    assert spread_words("  ", 0.0, 1.0) == []
    assert words_from_segments([{"text": " ", "start": 0.0, "end": 1.0}]) == ([], 0)

def test_aligned_words_pass_through():
    seg = {"text": " Kumusta", "start": 0.1, "end": 0.5, "words": [{"word": " Kumusta", "start": 0.1, "end": 0.5, "score": 0.9}]}
    assert words_from_segments([seg]) == ([{"text": "Kumusta", "start": 0.1, "end": 0.5, "score": 0.9}], 0)

def test_untimed_run_is_spread_between_timed_neighbours():
    seg = {"text": "Ako ay si Ben", "start": 0.0, "end": 1.6, "words": [
        {"word": "Ako", "start": 0.0, "end": 0.3, "score": 0.8}, {"word": "ay"}, {"word": "si"}, {"word": "Ben", "start": 1.3, "end": 1.6, "score": 0.7}]}
    words, estimated = words_from_segments([seg])
    assert [w["text"] for w in words] == ["Ako", "ay", "si", "Ben"]
    assert (words[1], words[2]) == ({"text": "ay", "start": 0.3, "end": 0.8}, {"text": "si", "start": 0.8, "end": 1.3})
    assert estimated == 0  # pinned between aligned neighbours (a number, a symbol): close enough not to warn about

def test_segment_without_words_is_spread():
    words, estimated = words_from_segments([{"text": "Oo nga", "start": 2.0, "end": 3.0}])
    assert words == [{"text": "Oo", "start": 2.0, "end": 2.4}, {"text": "nga", "start": 2.4, "end": 3.0}]
    assert estimated == 2

def test_segment_with_no_timed_word_counts():
    words, estimated = words_from_segments([{"text": "Oo nga", "start": 2.0, "end": 3.0, "words": [{"word": "Oo"}, {"word": "nga"}]}])
    assert [w["text"] for w in words] == ["Oo", "nga"]
    assert estimated == 2

# whisperX 3.8.6 returns a segment it failed to align with "words": [] (no clean chars, past the audio, backtrack failure).
def test_failed_alignment_empty_words_is_spread():
    words, estimated = words_from_segments([{"text": " Oo nga", "start": 2.0, "end": 3.0, "words": [], "chars": None}])
    assert [w["text"] for w in words] == ["Oo", "nga"]
    assert estimated == 2
