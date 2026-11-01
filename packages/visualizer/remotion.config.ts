import { Config } from "@remotion/cli/config";
import { withSharedSources } from "./webpack-override";

Config.overrideWebpackConfig(withSharedSources);
