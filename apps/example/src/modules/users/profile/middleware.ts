import { mw } from "@nxlab/olio";

import { auditLog } from "../../../middleware.js";

export const middleware = mw.users({
  User: {
    role: [auditLog()]
  }
});
