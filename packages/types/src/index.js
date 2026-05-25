"use strict";
// =============================================================================
// @school-manager/types
// =============================================================================
// Single source of truth for all shapes that cross the network boundary.
// Used by both the web app (apps/web) and the API (apps/api).
//
// Rules:
//   1. Define every schema with Zod.
//   2. Export the Zod object AND the inferred TS type with the same name
//      (using TypeScript declaration merging).
//   3. Never import from @prisma/client here - this package must work in
//      browser environments too.
// =============================================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./schemas/common"), exports);
__exportStar(require("./schemas/auth"), exports);
__exportStar(require("./schemas/school"), exports);
__exportStar(require("./schemas/user"), exports);
__exportStar(require("./schemas/class"), exports);
__exportStar(require("./schemas/timetable"), exports);
__exportStar(require("./schemas/attendance"), exports);
__exportStar(require("./schemas/fees"), exports);
__exportStar(require("./schemas/announcement"), exports);
