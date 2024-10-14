/**
 * Generating all combinations for derivation path.
 * When maxDepth is 2 and maxLength is 2, the result is:
 * [[], [0], [1], [2], [0,0], [0,1], [0,2], [1,0], [1,1], [1,2], [2,0], [2,1], [2,2]]
 */
export function generateAllCombinations(
  maxDepth: number | undefined,
  maxLength: number | undefined
): number[][] {
  if (maxDepth === undefined || maxLength === undefined) {
    return []
  }

  const combinations: number[][] = [[]]
  function generate(prefix: number[], remainingLength: number): void {
    if (remainingLength === 0) {
      combinations.push(prefix)
      return
    }
    for (let i = 0; i <= maxDepth!; i++) {
      generate([...prefix, i], remainingLength - 1)
    }
  }
  for (let length = 1; length <= maxLength; length++) {
    generate([], length)
  }
  return combinations
}

/**
 *
 * Parsing the derived path string to check heuristic depth and wide.
 * The method may be provided with path depth and wide that is expected
 * to be searched by default but the purpose of the method is to check
 * what is derived path provided by caller and based on the path
 * providing back what is the scope of possible heuristic search.
 *
 * Method expects the path starts with '<m>/purpose/cointype/...
 * When the derived path is e.g., 44'/501'/0/0/5 then
 * the wide will be 3, depth will be max of the provided numbers as it's 5.
 */
export function getHeuristicDepthAndWide(
  derivedPath: string,
  defaultDepth = 20,
  defaultWide = 2
): { depth: number; wide: number } {
  let depth = defaultDepth
  let wide = defaultWide

  let splitDerivedPath = derivedPath.split('/')
  // we expect derived path starts with solana derivation path 44'/501'
  // going to check parts after first 2
  if (splitDerivedPath.length > 2) {
    splitDerivedPath = splitDerivedPath.slice(2)
    wide = Math.max(defaultWide, splitDerivedPath.length)
    depth = Math.max(defaultDepth, ...splitDerivedPath.map(v => parseFloat(v)))
  }
  return { depth, wide }
}
