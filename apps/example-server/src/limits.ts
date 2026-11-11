import { exclRule } from "@nxara/olio";
import type { ValidationRules } from "@nxara/olio-http";
import {
  createComplexityRule,
  fieldExtensionsEstimator,
  simpleEstimator
} from "graphql-query-complexity";

/**
 * One rule set for HTTP (http.ts), SSE and WebSocket (subscriptions.ts): an
 * operation costs at most 1000, and an `@excl` field (login, logout) is
 * the only field in its operation. Fields price themselves through their
 * `complexity` extension; any other field costs 1.
 */
export const validationRules: ValidationRules = ({ variables }) => [
  exclRule,
  createComplexityRule({
    maximumComplexity: 1000,
    variables,
    estimators: [
      fieldExtensionsEstimator(),
      simpleEstimator({ defaultComplexity: 1 })
    ]
  })
];
