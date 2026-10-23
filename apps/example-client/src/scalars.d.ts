import type { Scalar } from "@nxlab/client";

declare module "@nxlab/client" {
  interface ClientScalars {
    DateTime: string;
  }
}

/** A DateTime as it arrives: an ISO 8601 string. */
export type DateTime = Scalar<"DateTime">;
