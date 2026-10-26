import type { ValidationRules } from "@nxlab/http";
import {
  createComplexityRule,
  fieldExtensionsEstimator,
  simpleEstimator
} from "graphql-query-complexity";

/**
 * One rule set for HTTP (http.ts), SSE and WebSocket (subscriptions.ts): an
 * operation costs at most 1000. Fields price themselves through their
 * `complexity` extension; any other field costs 1.
 */
export const validationRules: ValidationRules = ({ variables }) => [
  createComplexityRule({
    maximumComplexity: 1000,
    variables,
    estimators: [
      fieldExtensionsEstimator(),
      simpleEstimator({ defaultComplexity: 1 })
    ]
  })
];
