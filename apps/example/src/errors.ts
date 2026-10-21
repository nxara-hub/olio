import { GraphQLError } from "graphql";

type Code =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "BAD_USER_INPUT"
  | "TOO_MANY_REQUESTS";

/**
 * An error the client should see. Anything else that's thrown is a bug and
 * reaches clients as "Unexpected error." (see `maskErrors` in @nxlab/http).
 */
export const clientError = (code: Code, message: string): GraphQLError =>
  new GraphQLError(message, { extensions: { code } });
