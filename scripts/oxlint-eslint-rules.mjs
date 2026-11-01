// ESLint core rules that Oxlint's native ports skip or under-report, run inside Oxlint as a
// jsPlugin so no rule from the old ESLint config is lost:
// - getter-return: Oxlint's native rule skips .ts files (it defers to tsc, but tsc only
//   checks src/; test/unit and test/helpers are never typechecked).
// - no-unreachable: the native rule misses a catch block after a try that cannot throw.
import { builtinRules } from 'eslint/use-at-your-own-risk';

const names = ['getter-return', 'no-unreachable'];

export default {
  meta: { name: 'eslint-js' },
  rules: Object.fromEntries(names.map((name) => [name, builtinRules.get(name)])),
};
