## 0.3.3 (2026-05-19)

### 🚀 Features

- **prose:** durability system + docs + MCP server updates ([#2](https://github.com/celom/prose/pull/2))

### ❤️ Thank You

- Carlos Mimoso
- Claude Opus 4.7 (1M context)

## 0.3.2 (2026-02-28)

### 🚀 Features

- **mcp:** implement MCP server and tools for flow analysis directly unto the prose library ([eb02360](https://github.com/celom/prose/commit/eb02360))

### ❤️ Thank You

- Carlos Mimoso

## 0.3.1 (2026-02-27)

This was a version bump only for @celom/prose to align it with other projects, there were no code changes.

## 0.3.0 (2026-02-27)

### 🚀 Features

- remove outdated examples and improve type inference in DatabaseClient and TxClient ([729c28c](https://github.com/celom/prose/commit/729c28c))

### ❤️ Thank You

- Carlos Mimoso

## 0.2.1 (2026-02-26)

### 🩹 Fixes

- fix transaction client type inference in DatabaseClient and FlowBuilder ([fa3d8da](https://github.com/celom/prose/commit/fa3d8da))

### ❤️ Thank You

- Carlos Mimoso

## 0.2.0 (2026-02-26)

### 🚀 Features

- add transaction type inference and example workflow for order fulfillment ([d6e1c65](https://github.com/celom/prose/commit/d6e1c65))

### ❤️ Thank You

- Carlos Mimoso

## 0.1.4 (2026-02-26)

### 🩹 Fixes

- add license field to package.json ([6643dce](https://github.com/celom/prose/commit/6643dce))
- add build step to release workflow for new releases ([4b60d14](https://github.com/celom/prose/commit/4b60d14))

### ❤️ Thank You

- Carlos Mimoso

## 0.1.3 (2026-02-26)

### 🩹 Fixes

- add conditional git push step in release workflow for new releases ([483e39f](https://github.com/celom/prose/commit/483e39f))
- update release workflow to conditionally publish based on new release detection ([a79a264](https://github.com/celom/prose/commit/a79a264))
- uncomment npm install command in release workflow ([ee4edd0](https://github.com/celom/prose/commit/ee4edd0))
- update release workflow to include access level in npm publish command ([44dbeb1](https://github.com/celom/prose/commit/44dbeb1))
- update release workflow to use npm run publish instead of bun run publish ([848cb88](https://github.com/celom/prose/commit/848cb88))
- update release workflow to enable environment setting and simplify publish command ([7d435ad](https://github.com/celom/prose/commit/7d435ad))
- update release workflow to remove unused environment variable and simplify npm publish command ([ef4cddc](https://github.com/celom/prose/commit/ef4cddc))
- update release workflow to use npm run publish command ([44a83a0](https://github.com/celom/prose/commit/44a83a0))
- update release workflow to use npm publish and remove nx release command ([f4a87be](https://github.com/celom/prose/commit/f4a87be))
- add cli configuration for npm package manager in nx.json ([37f823a](https://github.com/celom/prose/commit/37f823a))
- remove redundant --yes flag from release command ([dec835c](https://github.com/celom/prose/commit/dec835c))

### ❤️ Thank You

- Carlos Mimoso

## 0.1.2 (2026-02-26)

### 🩹 Fixes

- update release workflow to include publish step ([f81e753](https://github.com/celom/flume/commit/f81e753))
- add homepage field to package.json files ([b259b5d](https://github.com/celom/flume/commit/b259b5d))
- update package versions and set project as private ([d897e62](https://github.com/celom/flume/commit/d897e62))
- update release workflow to include setup-node step and registry URL ([20de5f0](https://github.com/celom/flume/commit/20de5f0))

### ❤️ Thank You

- Carlos Mimoso

## 0.1.1 (2026-02-26)

### 🩹 Fixes

- retain outputMapper in FlowBuilder steps for consistent state handling ([2042b38](https://github.com/celom/prose/commit/2042b38))
- update repository URL format in package.json ([3037775](https://github.com/celom/prose/commit/3037775))
- change package.json private field to false ([a8b7460](https://github.com/celom/prose/commit/a8b7460))
- update repository URL format in package.json and add release workflow ([889995a](https://github.com/celom/prose/commit/889995a))

### ❤️ Thank You

- Carlos Mimoso

## 0.1.0 (2026-02-25)

### 🚀 Features

- update package.json files to include repository information and enhance metadata ([d9a9e9b](https://github.com/celom/prose/commit/d9a9e9b))
- **docs:** Add comprehensive documentation for Prose core concepts, examples, and guides ([47fbc93](https://github.com/celom/prose/commit/47fbc93))
- implement AbortSignal support for cooperative cancellation in flow execution ([11cf776](https://github.com/celom/prose/commit/11cf776))
- remove composeFlows function in favor of new pipe chain. ([a30fecb](https://github.com/celom/prose/commit/a30fecb))
- add .pipe() method to FlowBuilder for reusable sub-flows and implement tests for its functionality ([be46068](https://github.com/celom/prose/commit/be46068))
- extend FlowBuilder and FlowDefinition to support break outputs ([fb5473d](https://github.com/celom/prose/commit/fb5473d))
- add type inference smoke test for FlowBuilder's cons-list internals ([fc50f9e](https://github.com/celom/prose/commit/fc50f9e))

### 🩹 Fixes

- **ci:** update commands to use bunx for consistency in CI workflow ([3cefd8e](https://github.com/celom/prose/commit/3cefd8e))
- remove unused BreakStepDefinition import in flow-builder and adjust break step handling in flow-executor ([b3ef39d](https://github.com/celom/prose/commit/b3ef39d))
- update transaction method to require name parameter in FlowBuilder ([792ec14](https://github.com/celom/prose/commit/792ec14))

### ❤️ Thank You

- Carlos Mimoso