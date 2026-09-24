"""Deterministic arithmetic for data-validation skill instructions."""
import ast
import math
import operator
import re
from decimal import Decimal, localcontext

from logger import get_logger

logger = get_logger(__name__)
MAX_CALCULATIONS = 5
MAX_EXPRESSION_CHARS = 200
MAX_AST_NODES = 64
BINARY_OPERATORS = {ast.Add: operator.add, ast.Sub: operator.sub,
                    ast.Mult: operator.mul, ast.Div: operator.truediv}
GROUPED_NUMBER_PATTERN = re.compile(r'(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)')
NUMBER_PATTERN = re.compile(r'(?<![\w.])\d+(?:\.\d+)?')


def calculate_expression(expression: str, question: str) -> str:
    """Evaluate only bounded decimal arithmetic; never execute Python code."""
    if len(expression) > MAX_EXPRESSION_CHARS:
        raise ValueError('expression too long')
    node = ast.parse(expression, mode='eval')
    if len(list(ast.walk(node))) > MAX_AST_NODES:
        raise ValueError('expression too complex')
    numeric_source = GROUPED_NUMBER_PATTERN.sub(lambda match: match.group().replace(',', ''), question)
    permitted = {Decimal(value) for value in NUMBER_PATTERN.findall(numeric_source)}
    permitted.update({Decimal(0), Decimal(1), Decimal(100)})

    def evaluate(item):
        if isinstance(item, ast.Expression):
            return evaluate(item.body)
        if isinstance(item, ast.Constant) and type(item.value) in (int, float):
            if not math.isfinite(item.value):
                raise ValueError('non-finite number')
            value = Decimal(ast.get_source_segment(expression, item))
            if value not in permitted:
                raise ValueError('operand absent from source')
            return value
        if isinstance(item, ast.UnaryOp) and isinstance(item.op, (ast.UAdd, ast.USub)):
            value = evaluate(item.operand)
            return -value if isinstance(item.op, ast.USub) else value
        if isinstance(item, ast.BinOp) and type(item.op) in BINARY_OPERATORS:
            return BINARY_OPERATORS[type(item.op)](evaluate(item.left), evaluate(item.right))
        raise ValueError('unsupported arithmetic')

    with localcontext() as context:
        context.prec = 28
        result = evaluate(node)
        if not result.is_finite() or abs(result) > Decimal('1e30'):
            raise ValueError('result out of bounds')
        return format(result.normalize(), 'f') if result else '0'


def calculation_context(question: str, plan) -> str:
    lines = []
    if isinstance(plan, list):
        for item in plan[:MAX_CALCULATIONS]:
            if not isinstance(item, dict) or not isinstance(item.get('expression'), str):
                continue
            try:
                expression = item['expression']
                result = calculate_expression(expression, question)
                lines.append(f'{expression} = {result}')
            except (ValueError, SyntaxError, ArithmeticError, OverflowError, TypeError):
                continue
    if not lines:
        return ('[Calculation verification]\nNo arithmetic result was verified by the calculator. '
                'Do not claim that numeric results were independently checked. '
                'Explain the formula and identify missing or ambiguous inputs when relevant.')
    return ('[Calculation verification]\nThe backend calculator evaluated these expressions:\n'
            + '\n'.join(lines) + '\nUse these exact arithmetic results; do not replace them with mental estimates. '
            'The expression selection is a model interpretation, not proof that the inputs or methodology are correct. '
            'Check that the formula matches the user\'s requested metric. Do not claim source-data verification.')
