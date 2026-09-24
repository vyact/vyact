import unittest

from services.skill_routing import calculate_expression, calculation_context


class ArithmeticTests(unittest.TestCase):
    def test_weighted_rate_and_exact_decimal(self):
        self.assertEqual(float(calculate_expression('(10+90)/(100+900)*100', '10 90 100 900')), 10)
        self.assertEqual(calculate_expression('(20+90)/(100+900)*100', '20 90 100 900'), '11')
        self.assertEqual(calculate_expression('0.1+0.2', '0.1 0.2'), '0.3')
        self.assertEqual(calculate_expression('10+90', 'values: 10,90'), '100')
        self.assertEqual(calculate_expression('1000/10', '1,000 visits; 10 groups'), '100')

    def test_rejects_code_and_unsupported_numbers(self):
        for expression in ['__import__("os").system("id")', '2**1000000', 'open("x")', '[1][0]', 'True+1', '999/100', '1/0']:
            with self.subTest(expression=expression), self.assertRaises((ValueError, ArithmeticError)):
                calculate_expression(expression, '2 100')

    def test_failed_plan_never_claims_verified_results(self):
        context = calculation_context('10 100', [{'expression': '200/100'}])
        self.assertIn('No arithmetic result was verified', context)
