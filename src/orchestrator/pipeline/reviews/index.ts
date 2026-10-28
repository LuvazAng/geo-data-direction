// Revisión manual de los trazos que el pipeline no pudo decidir: API pública del módulo.
export { mapStatus } from './status';
export { duplaFolders, renumberDuplas } from './duplas';
export { reviewSnapshot } from './snapshot';
export { buildResolvedKml, type ResolveReviewInput, resolveReview, resolveReviews, undoMapReviews } from './resolve';
export { type EvaluateMapInput, evaluateMap, decideMap } from './evaluate';
