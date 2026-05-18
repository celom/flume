import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { QUICK_REFERENCE } from '../content/quick-reference.js';
import {
  CREATE_FLOW_REFERENCE,
  FLOW_BUILDER_REFERENCE,
  TYPES_REFERENCE,
  EXECUTION_OPTIONS_REFERENCE,
  ERROR_TYPES_REFERENCE,
  OBSERVERS_REFERENCE,
  DURABILITY_REFERENCE,
} from '../content/api-reference.js';
import { GUIDES, GUIDE_TOPICS } from '../content/guides.js';
import { EXAMPLES, EXAMPLE_NAMES } from '../content/examples.js';

export function registerResources(server: McpServer) {
  // Quick reference cheatsheet
  server.registerResource('quick-reference', 'prose://api/quick-reference', {
    description:
      'Concise cheatsheet for all @celom/prose FlowBuilder methods, types, and patterns',
    mimeType: 'text/markdown',
  }, async (uri) => ({
    contents: [{ uri: uri.href, text: QUICK_REFERENCE, mimeType: 'text/markdown' }],
  }));

  // API references
  server.registerResource('api-create-flow', 'prose://api/create-flow', {
    description: 'API reference for createFlow() — the entry point for building flows',
    mimeType: 'text/markdown',
  }, async (uri) => ({
    contents: [{ uri: uri.href, text: CREATE_FLOW_REFERENCE, mimeType: 'text/markdown' }],
  }));

  server.registerResource('api-flow-builder', 'prose://api/flow-builder', {
    description: 'API reference for all FlowBuilder methods',
    mimeType: 'text/markdown',
  }, async (uri) => ({
    contents: [{ uri: uri.href, text: FLOW_BUILDER_REFERENCE, mimeType: 'text/markdown' }],
  }));

  server.registerResource('api-types', 'prose://api/types', {
    description:
      'Type reference for FlowContext, FlowMeta, RetryOptions, FlowEvent, DatabaseClient, etc.',
    mimeType: 'text/markdown',
  }, async (uri) => ({
    contents: [{ uri: uri.href, text: TYPES_REFERENCE, mimeType: 'text/markdown' }],
  }));

  server.registerResource('api-execution-options', 'prose://api/execution-options', {
    description: 'API reference for FlowExecutionOptions passed to flow.execute()',
    mimeType: 'text/markdown',
  }, async (uri) => ({
    contents: [{ uri: uri.href, text: EXECUTION_OPTIONS_REFERENCE, mimeType: 'text/markdown' }],
  }));

  server.registerResource('api-error-types', 'prose://api/error-types', {
    description:
      'API reference for ValidationError, FlowExecutionError, and TimeoutError',
    mimeType: 'text/markdown',
  }, async (uri) => ({
    contents: [{ uri: uri.href, text: ERROR_TYPES_REFERENCE, mimeType: 'text/markdown' }],
  }));

  server.registerResource('api-observers', 'prose://api/observers', {
    description:
      'API reference for FlowObserver interface and built-in observer implementations',
    mimeType: 'text/markdown',
  }, async (uri) => ({
    contents: [{ uri: uri.href, text: OBSERVERS_REFERENCE, mimeType: 'text/markdown' }],
  }));

  server.registerResource('api-durability-store', 'prose://api/durability-store', {
    description:
      'API reference for opt-in durability — DurabilityStore, DurabilityOptions, FlowCheckpoint, and MemoryDurabilityStore',
    mimeType: 'text/markdown',
  }, async (uri) => ({
    contents: [{ uri: uri.href, text: DURABILITY_REFERENCE, mimeType: 'text/markdown' }],
  }));

  // Guide resources (dynamic template)
  const guideTemplate = new ResourceTemplate('prose://guides/{topic}', {
    list: async () => ({
      resources: GUIDE_TOPICS.map((topic) => ({
        uri: `prose://guides/${topic}`,
        name: topic,
        description: `Guide: ${topic}`,
        mimeType: 'text/markdown' as const,
      })),
    }),
  });

  server.registerResource(
    'guide',
    guideTemplate,
    {
      description: `Feature guides for @celom/prose. Available topics: ${GUIDE_TOPICS.join(', ')}`,
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const topic = variables.topic as string;
      const content = GUIDES[topic];
      if (!content) {
        throw new Error(
          `Unknown guide topic: ${topic}. Available: ${GUIDE_TOPICS.join(', ')}`,
        );
      }
      return {
        contents: [{ uri: uri.href, text: content, mimeType: 'text/markdown' }],
      };
    },
  );

  // Example resources (dynamic template)
  const exampleTemplate = new ResourceTemplate('prose://examples/{name}', {
    list: async () => ({
      resources: EXAMPLE_NAMES.map((name) => ({
        uri: `prose://examples/${name}`,
        name,
        description: `Example: ${name}`,
        mimeType: 'text/markdown' as const,
      })),
    }),
  });

  server.registerResource(
    'example',
    exampleTemplate,
    {
      description: `Complete worked examples. Available: ${EXAMPLE_NAMES.join(', ')}`,
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const name = variables.name as string;
      const content = EXAMPLES[name];
      if (!content) {
        throw new Error(
          `Unknown example: ${name}. Available: ${EXAMPLE_NAMES.join(', ')}`,
        );
      }
      return {
        contents: [{ uri: uri.href, text: content, mimeType: 'text/markdown' }],
      };
    },
  );
}
