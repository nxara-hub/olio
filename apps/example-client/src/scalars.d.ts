import type { Scalar } from "@nxara/olio-client";

declare module "@nxara/olio-client" {
  interface ClientScalars {
    DateTime: string;
  }
}

/** A DateTime as it arrives: an ISO 8601 string. */
export type DateTime = Scalar<"DateTime">;
