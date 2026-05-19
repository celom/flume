// @ts-check-only

/**
 * Type inference smoke test for FlowBuilder's cons-list internals.
 * This file is NOT meant to be executed — only type-checked.
 *
 * Run: npx tsc --noEmit --project packages/prose/tsconfig.lib.json
 */

import { createFlow, type FlowBuilder } from './lib/flow-builder.js';
import { MemoryDurabilityStore } from './lib/memory-store.js';
import type {
  BaseFlowDependencies,
  DurabilityOptions,
  DurabilityStore,
  FlowCheckpoint,
} from './lib/types.js';

// ── Setup ────────────────────────────────────────────────

interface OrderInput {
  orderId: string;
  userId: string;
  amount: number;
}

interface OrderDeps extends BaseFlowDependencies {
  paymentGateway: {
    charge(amount: number): Promise<{ transactionId: string }>;
  };
}

// ── Flow definition ──────────────────────────────────────

const orderFlow = createFlow<OrderInput, OrderDeps>('processOrder')
  .validate('checkAmount', (ctx) => {
    // ctx.input should be OrderInput
    void (ctx.input.amount satisfies number);
    void (ctx.input.orderId satisfies string);

    if (ctx.input.amount <= 0) throw new Error('Invalid amount');
  })
  .step('loadUser', (ctx) => {
    return { user: { id: ctx.input.userId, name: 'Alice' } };
  })
  .step('chargePayment', async (ctx) => {
    // State should now include { user: ... } from prior step
    void (ctx.state.user.name satisfies string);

    const receipt = await ctx.deps.paymentGateway.charge(ctx.input.amount);
    return { transactionId: receipt.transactionId };
  })
  .stepIf(
    'applyDiscount',
    (ctx) => ctx.input.amount > 100,
    (ctx) => {
      // Should see user AND transactionId on state
      void (ctx.state.transactionId satisfies string);
      void (ctx.state.user satisfies { id: string; name: string });
      return { discountApplied: true as const };
    }
  )
  .map((input, state) => {
    // State should have user, transactionId, and discountApplied
    return {
      orderId: input.orderId,
      transactionId: state.transactionId,
      discountApplied: state.discountApplied,
      customerName: state.user.name,
    };
  })
  .build();

// ── Branching from a shared base ─────────────────────────

const base = createFlow<{ x: number }, never>('branching').step(
  'double',
  (ctx) => ({ doubled: ctx.input.x * 2 })
);

const branchA = base
  .step('addTen', (ctx) => {
    void (ctx.state.doubled satisfies number);
    return { result: ctx.state.doubled + 10 };
  })
  .build();

const branchB = base
  .step('negate', (ctx) => {
    void (ctx.state.doubled satisfies number);
    return { result: -ctx.state.doubled };
  })
  .build();

// ── Break output type propagation ────────────────────────

interface CacheInput {
  key: string;
}

interface CacheDeps extends BaseFlowDependencies {
  cache: { get(key: string): string | null };
}

const cachedLookup = createFlow<CacheInput, CacheDeps>('cachedLookup')
  .step('checkCache', (ctx) => {
    const hit = ctx.deps.cache.get(ctx.input.key);
    return { cacheHit: hit !== null, cachedValue: hit };
  })
  .breakIf(
    (ctx) => ctx.state.cacheHit,
    (ctx) => ({ fromCache: true as const, value: ctx.state.cachedValue! })
  )
  .step('fetchFromDb', (ctx) => {
    void (ctx.input.key satisfies string);
    return { freshValue: `db_result_for_${ctx.input.key}` };
  })
  .map((_input, state) => ({
    fromCache: false as const,
    freshValue: state.freshValue,
  }))
  .build();

// ── Parallel builder method ─────────────────────────────

interface FetchDeps extends BaseFlowDependencies {
  api: { getUsers(): Promise<string[]>; getPosts(): Promise<string[]> };
}

const parallelFlow = createFlow<{ orgId: string }, FetchDeps>('parallelFetch')
  .step('init', (ctx) => ({ orgId: ctx.input.orgId }))
  .parallel(
    'fetchAll',
    'shallow',
    async (ctx) => {
      const users = await ctx.deps.api.getUsers();
      return { users };
    },
    async (ctx) => {
      const posts = await ctx.deps.api.getPosts();
      return { posts };
    }
  )
  .step('summarize', (ctx) => {
    // State should have orgId, users, and posts from the parallel step
    void (ctx.state.orgId satisfies string);
    void (ctx.state.users satisfies string[]);
    void (ctx.state.posts satisfies string[]);
    return {
      summary: `${ctx.state.users.length} users, ${ctx.state.posts.length} posts`,
    };
  })
  .build();

// ── Pipe for reusable sub-flows ─────────────────────────

function withAuth<
  TInput extends { token: string },
  TDeps extends BaseFlowDependencies,
  TState extends Record<string, unknown>
>(builder: FlowBuilder<TInput, TDeps, TState>) {
  return builder
    .step('validateToken', (ctx) => ({ tokenData: { sub: ctx.input.token } }))
    .step('loadUser', (ctx) => ({
      user: { id: ctx.state.tokenData.sub, role: 'admin' as const },
    }));
}

const authedFlow = createFlow<{ token: string; action: string }, never>(
  'authed-action'
)
  .pipe(withAuth)
  .step('doAction', (ctx) => {
    // State should have tokenData and user from the piped sub-flow
    void (ctx.state.tokenData.sub satisfies string);
    void (ctx.state.user.id satisfies string);
    void (ctx.state.user.role satisfies 'admin');
    return { actionDone: true as const };
  })
  .build();

// ── Parallel chained with subsequent steps ──────────────

const combinedFlow = createFlow<{ id: string }, never>('combined')
  .step('load', () => ({ loaded: true as const }))
  .parallel(
    'fetch',
    'shallow',
    () => ({ a: 1 }),
    () => ({ b: 'two' })
  )
  .step('process', (ctx) => {
    // Should see loaded, a, b from prior steps
    void (ctx.state.loaded satisfies true);
    void (ctx.state.a satisfies number);
    void (ctx.state.b satisfies string);
    return { processed: true as const };
  })
  .step('finalize', () => ({ finalized: true as const }))
  .build();

// ── Transaction step with typed tx ───────────────────────

interface InventoryItem {
  sku: string;
  qty: number;
}

interface WarehouseTx {
  deduct(sku: string, qty: number): Promise<{ remaining: number }>;
  insertShipment(data: {
    orderId: string;
    sku: string;
    qty: number;
  }): Promise<{ shipmentId: string }>;
}

interface WarehouseDeps extends BaseFlowDependencies {
  db: {
    transaction<T>(fn: (tx: WarehouseTx) => Promise<T>): Promise<T>;
  };
}

const fulfillOrder = createFlow<
  { orderId: string; items: InventoryItem[] },
  WarehouseDeps
>('fulfillOrder')
  .step('loadOrder', (ctx) => {
    return { orderId: ctx.input.orderId, items: ctx.input.items };
  })
  .transaction('reserveAndShip', async (ctx, tx) => {
    // tx is inferred as WarehouseTx from TDeps — no manual cast needed
    const shipments: string[] = [];
    for (const item of ctx.state.items) {
      await tx.deduct(item.sku, item.qty);
      const { shipmentId } = await tx.insertShipment({
        orderId: ctx.state.orderId,
        sku: item.sku,
        qty: item.qty,
      });
      shipments.push(shipmentId);
    }
    return { shipmentIds: shipments };
  })
  .step('confirm', (ctx) => {
    // State should have orderId, items, and shipmentIds from the transaction
    void (ctx.state.orderId satisfies string);
    void (ctx.state.items satisfies InventoryItem[]);
    void (ctx.state.shipmentIds satisfies string[]);
    return { confirmed: true as const };
  })
  .build();

// ── Durability: meta fields, options, store adapter ─────

const durableFlow = createFlow<{ orderId: string }, never>('durableOrder')
  .step('reserve', (ctx) => {
    // Durability-only meta fields are optional (undefined when no store is configured)
    void (ctx.meta.idempotencyKey satisfies string | undefined);
    void (ctx.meta.runId satisfies string | undefined);
    void (ctx.meta.isResuming satisfies boolean | undefined);
    return { reserved: true as const };
  })
  .step('ship', (ctx) => {
    void (ctx.state.reserved satisfies true);
    return { shipmentId: `ship-${ctx.input.orderId}` };
  })
  .map((input, state) => ({
    orderId: input.orderId,
    shipmentId: state.shipmentId,
  }))
  .build();

// MemoryDurabilityStore satisfies the DurabilityStore interface
const _memStore: DurabilityStore = new MemoryDurabilityStore();

// DurabilityOptions structural shape
const _durabilityOpts: DurabilityOptions = {
  store: new MemoryDurabilityStore(),
  runId: 'order-42',
};
void _durabilityOpts;

// Custom DurabilityStore adapter — verifies the interface contract
const customStore: DurabilityStore = {
  async load(runId) {
    void (runId satisfies string);
    return null;
  },
  async save(checkpoint) {
    void (checkpoint.flowName satisfies string);
    void (checkpoint.runId satisfies string);
    void (checkpoint.input satisfies unknown);
    void (checkpoint.state satisfies unknown);
    void (checkpoint.completedSteps satisfies string[]);
    void (checkpoint.status satisfies 'running' | 'completed' | 'failed');
    void (checkpoint.breakValue satisfies unknown);
    void (checkpoint.failedStep satisfies
      | { name: string; error: string }
      | undefined);
    void (checkpoint.createdAt satisfies Date);
    void (checkpoint.updatedAt satisfies Date);
  },
  async delete(runId) {
    void (runId satisfies string);
  },
};
void customStore;

// FlowCheckpoint structural shape (the value an adapter would persist)
const _checkpoint: FlowCheckpoint = {
  flowName: 'durableOrder',
  runId: 'order-42',
  input: { orderId: 'o1' },
  state: { reserved: true },
  completedSteps: ['reserve'],
  status: 'running',
  createdAt: new Date(),
  updatedAt: new Date(),
};
void _checkpoint;

// ── Verify output types ──────────────────────────────────

async function _typeAssertions() {
  const orderResult = await orderFlow.execute(
    { orderId: '1', userId: 'u1', amount: 50 },
    { paymentGateway: { charge: async () => ({ transactionId: 'tx1' }) } }
  );
  void (orderResult.orderId satisfies string);
  void (orderResult.transactionId satisfies string);
  void (orderResult.discountApplied satisfies true);
  void (orderResult.customerName satisfies string);

  const resultA = await branchA.execute({ x: 5 }, undefined as never);
  void (resultA.result satisfies number);
  void (resultA.doubled satisfies number);

  const resultB = await branchB.execute({ x: 5 }, undefined as never);
  void (resultB.result satisfies number);
  void (resultB.doubled satisfies number);

  // Break output produces a union: normal path | break path
  const cacheResult = await cachedLookup.execute(
    { key: 'test' },
    { cache: { get: () => null } }
  );
  void (cacheResult.fromCache satisfies boolean);
  void ('value' in cacheResult && (cacheResult.value satisfies string));
  void (
    'freshValue' in cacheResult && (cacheResult.freshValue satisfies string)
  );

  // Narrowing works via the discriminant
  if (cacheResult.fromCache) {
    void (cacheResult satisfies { fromCache: true; value: string });
  } else {
    void (cacheResult satisfies { fromCache: false; freshValue: string });
  }

  // Parallel builder output should merge all handler results + prior state
  const parallelResult = await parallelFlow.execute(
    { orgId: 'org1' },
    { api: { getUsers: async () => ['a'], getPosts: async () => ['p'] } }
  );
  void (parallelResult.orgId satisfies string);
  void (parallelResult.users satisfies string[]);
  void (parallelResult.posts satisfies string[]);
  void (parallelResult.summary satisfies string);

  // Transaction output should merge into state
  const fulfillResult = await fulfillOrder.execute(
    { orderId: 'o1', items: [{ sku: 'ABC', qty: 2 }] },
    {
      db: {
        transaction: async (fn) =>
          fn({
            deduct: async () => ({ remaining: 8 }),
            insertShipment: async () => ({ shipmentId: 's1' }),
          } as WarehouseTx),
      },
    }
  );
  void (fulfillResult.orderId satisfies string);
  void (fulfillResult.items satisfies InventoryItem[]);
  void (fulfillResult.shipmentIds satisfies string[]);
  void (fulfillResult.confirmed satisfies true);

  // Durability option accepted by execute() — output type unaffected by store
  const store = new MemoryDurabilityStore();
  const durableResult = await durableFlow.execute(
    { orderId: 'o1' },
    undefined as never,
    { durability: { store, runId: 'order-42' } }
  );
  void (durableResult.orderId satisfies string);
  void (durableResult.shipmentId satisfies string);

  // Store helpers are typed
  void ((await store.load('order-42')) satisfies FlowCheckpoint | null);
  void (store.size() satisfies number);
  void (store.snapshot('order-42') satisfies FlowCheckpoint | null);

  // Combined flow chains parallel with subsequent steps
  const combinedResult = await combinedFlow.execute(
    { id: 'x' },
    undefined as never
  );
  void (combinedResult.loaded satisfies true);
  void (combinedResult.a satisfies number);
  void (combinedResult.b satisfies string);
  void (combinedResult.processed satisfies true);
  void (combinedResult.finalized satisfies true);
}

void orderFlow;
void branchA;
void branchB;
void cachedLookup;
void parallelFlow;
void authedFlow;
void combinedFlow;
void fulfillOrder;
void durableFlow;
void _memStore;
void _typeAssertions;
