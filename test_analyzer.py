import unittest
from analyzer import analyze, tokenize


class AnalyzerTests(unittest.TestCase):
    def test_unused_variable(self):
        report = analyze('int main() {\n int cache = 42;\n return 0;\n}')
        self.assertTrue(any(w['type'] == 'Unused Variable' and w['line'] == 2 for w in report['warnings']))

    def test_overwritten_assignment(self):
        report = analyze('int main() {\n int score = 5;\n score = 9;\n cout << score;\n return 0;\n}')
        self.assertTrue(any(w['type'] == 'Redundant Assignment' and w['line'] == 2 for w in report['warnings']))

    def test_unreachable_after_return(self):
        report = analyze('int main() {\n return 0;\n cout << 3;\n}')
        self.assertTrue(any(w['type'] == 'Unreachable Code' and w['line'] == 3 for w in report['warnings']))

    def test_literal_condition(self):
        report = analyze('int main() {\n if (false) {\n  cout << 1;\n }\n return 0;\n}')
        self.assertTrue(any(w['type'] == 'Constant Condition' and w['line'] == 2 for w in report['warnings']))

    def test_clean_program_no_selected_warnings(self):
        report = analyze('int main() {\n int count = 3;\n cout << count;\n return 0;\n}')
        self.assertEqual(report['warnings'], [])

    def test_self_update_not_flagged_as_redundant(self):
        report = analyze('int main() {\n int x = 5;\n x = x + 1;\n cout << x;\n return 0;\n}')
        self.assertFalse(any(w['type'] == 'Redundant Assignment' for w in report['warnings']))

    def test_delimiters_in_strings_do_not_create_structure_errors(self):
        report = analyze('int main() {\n cout << "} ) ]";\n return 0;\n}')
        self.assertEqual(report['syntax_issues'], [])

    def test_tokenizer_categorizes_keywords_and_identifiers(self):
        values = tokenize('int total = 10;')
        self.assertEqual(values[0]['kind'], 'keyword')
        self.assertEqual(values[1]['kind'], 'identifier')
        self.assertEqual(values[3]['kind'], 'number')


if __name__ == '__main__':
    unittest.main(verbosity=2)
