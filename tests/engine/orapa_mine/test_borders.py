from amusement.engine.orapa_mine.board import BoardDimensions
from amusement.engine.orapa_mine.borders import LabelScheme
from amusement.engine.orapa_mine.raycast import Direction


def test_label_scheme_has_18_numbers_and_18_letters_for_default_board() -> None:
    scheme = LabelScheme(BoardDimensions(width=9, height=9))
    labels = scheme.all_labels()
    numbers = [label for label in labels if label.isdigit()]
    letters = [label for label in labels if label.isalpha()]
    assert len(numbers) == 18
    assert len(letters) == 18
    assert set(numbers) == {str(n) for n in range(1, 19)}
    assert set(letters) == {chr(ord("A") + i) for i in range(18)}


def test_number_1_enters_top_left_going_down() -> None:
    scheme = LabelScheme(BoardDimensions(width=9, height=9))
    entry = scheme.entry_for_label("1")
    assert entry.position == (0, -1)
    assert entry.direction == Direction.DOWN


def test_letter_a_enters_top_left_going_right() -> None:
    scheme = LabelScheme(BoardDimensions(width=9, height=9))
    entry = scheme.entry_for_label("A")
    assert entry.position == (-1, 0)
    assert entry.direction == Direction.RIGHT


def test_label_round_trip() -> None:
    scheme = LabelScheme(BoardDimensions(width=9, height=9))
    for label in scheme.all_labels():
        entry = scheme.entry_for_label(label)
        assert scheme.label_for_entry(entry) == label
