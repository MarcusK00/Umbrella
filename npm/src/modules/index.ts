import type { McpProductModule } from "../core/module-contract.js";
import { automateModule } from "./automate.js";
import { cmsModule } from "./cms.js";
import { formsModule } from "./forms.js";

/** The only list to edit when adding a product. CMS first: it is the default module for unprefixed filters. */
export const modules: McpProductModule[] = [cmsModule, formsModule, automateModule];
