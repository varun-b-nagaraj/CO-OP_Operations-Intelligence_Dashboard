'use client';

import { useMemo, useState } from 'react';

type DashboardView =
  | 'orders'
  | 'order-detail'
  | 'prompts'
  | 'inventory'
  | 'products'
  | 'vendors'
  | 'designs'
  | 'wishlist'
  | 'settings';

type OrderStatus =
  | 'Draft'
  | 'Submitted'
  | 'Approved'
  | 'Ordered'
  | 'Partially Received'
  | 'Received'
  | 'Archived';

type Priority = 'Normal' | 'Urgent';

type ProductRecord = {
  id: string;
  name: string;
  category: string;
  vendor: string;
  stock: number;
  reorderThreshold: number;
  parLevel: number;
};

type OrderLine = {
  id: string;
  item: string;
  qty: number;
  unitPrice: number;
  link: string;
  notes: string;
  receivedQty: number;
};

type OrderRecord = {
  id: string;
  vendor: string;
  status: OrderStatus;
  datePlaced: string;
  requestedDate: string;
  priority: Priority;
  reason: string;
  notes: string;
  lines: OrderLine[];
};

type VendorRecord = {
  id: string;
  vendor: string;
  orderingMethod: 'Online' | 'In-Store' | 'Phone';
  leadTime: number;
  notes: string;
};

type DesignRecord = {
  id: string;
  name: string;
  priority: 'Low' | 'Normal' | 'High';
  status: 'Idea' | 'Review' | 'Ready to Order' | 'Archived';
};

type WishlistRecord = {
  id: string;
  item: string;
  vendor: string;
  estimatedCost: number;
  priority: 'Low' | 'Normal' | 'High';
  status: 'Backlog' | 'Researching' | 'Approved';
};

type PromptRecord = {
  productId: string;
  product: string;
  currentStock: number;
  onOrder: number;
  suggestedQty: number;
  vendor: string;
  lastPrice: number;
};

const NAV_ITEMS: Array<{ id: DashboardView; label: string }> = [
  { id: 'orders', label: 'Orders' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'products', label: 'Products' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'designs', label: 'Designs' },
  { id: 'wishlist', label: 'Wishlist' },
  { id: 'settings', label: 'Settings' }
];

const ORDER_STATUS_FLOW: OrderStatus[] = [
  'Draft',
  'Submitted',
  'Approved',
  'Ordered',
  'Partially Received',
  'Received',
  'Archived'
];

const DEFAULT_REQUESTER = 'Eric Chaverria';
const DEFAULT_ACTIVITY = 'Round Rock CO-OP (School Store)';
const DEFAULT_ACCOUNT = '498-36-001-99-8468-6399';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

function lineTotal(line: OrderLine) {
  return line.qty * line.unitPrice;
}

function orderTotal(order: OrderRecord) {
  return order.lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

function isOpenOrder(status: OrderStatus) {
  return !['Received', 'Archived'].includes(status);
}

export function ProductDashboard() {
  const [activeView, setActiveView] = useState<DashboardView>('orders');
  const [settings, setSettings] = useState({
    requester: DEFAULT_REQUESTER,
    activityAccount: DEFAULT_ACTIVITY,
    accountNumber: DEFAULT_ACCOUNT
  });

  const [products] = useState<ProductRecord[]>([
    {
      id: 'prod-1',
      name: 'CO-OP Hoodie (Navy)',
      category: 'Apparel',
      vendor: 'Amazon',
      stock: 2,
      reorderThreshold: 5,
      parLevel: 24
    },
    {
      id: 'prod-2',
      name: 'Vinyl Sticker Pack',
      category: 'Merch',
      vendor: 'Hobby Lobby',
      stock: 0,
      reorderThreshold: 5,
      parLevel: 40
    },
    {
      id: 'prod-3',
      name: 'Bottled Water 24pk',
      category: 'Snacks',
      vendor: 'Sam\'s Club',
      stock: 7,
      reorderThreshold: 8,
      parLevel: 36
    },
    {
      id: 'prod-4',
      name: 'Graphic Tee (Black)',
      category: 'Apparel',
      vendor: 'Target',
      stock: 1,
      reorderThreshold: 6,
      parLevel: 30
    }
  ]);

  const [orders, setOrders] = useState<OrderRecord[]>([
    {
      id: 'PO-2026-00102',
      vendor: 'Amazon',
      status: 'Draft',
      datePlaced: '2026-02-27',
      requestedDate: '2026-03-05',
      priority: 'Urgent',
      reason: 'Restock spring apparel drop',
      notes: 'Need before Friday event setup.',
      lines: [
        {
          id: 'line-1',
          item: 'CO-OP Hoodie (Navy)',
          qty: 12,
          unitPrice: 24.5,
          link: 'https://example.com/hoodie',
          notes: 'Adult mixed sizes',
          receivedQty: 0
        },
        {
          id: 'line-2',
          item: 'Graphic Tee (Black)',
          qty: 20,
          unitPrice: 11.25,
          link: 'https://example.com/tshirt',
          notes: 'Include youth sizes',
          receivedQty: 0
        }
      ]
    },
    {
      id: 'PO-2026-00101',
      vendor: 'Hobby Lobby',
      status: 'Ordered',
      datePlaced: '2026-02-25',
      requestedDate: '2026-03-04',
      priority: 'Normal',
      reason: 'Sticker replenishment',
      notes: '',
      lines: [
        {
          id: 'line-3',
          item: 'Vinyl Sticker Pack',
          qty: 18,
          unitPrice: 3.75,
          link: 'https://example.com/stickers',
          notes: 'Assorted colors',
          receivedQty: 0
        }
      ]
    },
    {
      id: 'PO-2026-00100',
      vendor: 'Sam\'s Club',
      status: 'Partially Received',
      datePlaced: '2026-02-21',
      requestedDate: '2026-02-28',
      priority: 'Normal',
      reason: 'Beverage stock for store',
      notes: 'Backorder expected',
      lines: [
        {
          id: 'line-4',
          item: 'Bottled Water 24pk',
          qty: 12,
          unitPrice: 6.5,
          link: 'https://example.com/water',
          notes: '',
          receivedQty: 8
        }
      ]
    }
  ]);

  const [vendors, setVendors] = useState<VendorRecord[]>([
    { id: 'v-1', vendor: 'Coca-Cola', orderingMethod: 'Phone', leadTime: 3, notes: 'Weekly route rep' },
    { id: 'v-2', vendor: 'Sam\'s Club', orderingMethod: 'In-Store', leadTime: 2, notes: 'Tax exempt on file' },
    { id: 'v-3', vendor: 'HEB', orderingMethod: 'In-Store', leadTime: 1, notes: 'Use school purchase card' },
    { id: 'v-4', vendor: 'Amazon', orderingMethod: 'Online', leadTime: 4, notes: 'Prime business account' },
    { id: 'v-5', vendor: 'Hobby Lobby', orderingMethod: 'In-Store', leadTime: 5, notes: 'Submit quote first' },
    { id: 'v-6', vendor: 'Home Depot', orderingMethod: 'Online', leadTime: 6, notes: 'Use bulk pricing' },
    { id: 'v-7', vendor: 'Target', orderingMethod: 'Online', leadTime: 3, notes: 'Standard shipping' },
    { id: 'v-8', vendor: 'Party City', orderingMethod: 'Online', leadTime: 4, notes: 'Seasonal catalogs' }
  ]);

  const [designs] = useState<DesignRecord[]>([
    { id: 'd-1', name: 'Fall Hoodie 2026', priority: 'High', status: 'Ready to Order' },
    { id: 'd-2', name: 'Spirit Tee Retro', priority: 'Normal', status: 'Review' },
    { id: 'd-3', name: 'Sticker Sheet Vol. 2', priority: 'High', status: 'Idea' },
    { id: 'd-4', name: 'Winter Beanie Patch', priority: 'Low', status: 'Archived' }
  ]);

  const [wishlist] = useState<WishlistRecord[]>([
    {
      id: 'w-1',
      item: 'Canvas Tote Bags',
      vendor: 'Amazon',
      estimatedCost: 180,
      priority: 'Normal',
      status: 'Researching'
    },
    {
      id: 'w-2',
      item: 'Custom Lanyards',
      vendor: 'Target',
      estimatedCost: 140,
      priority: 'High',
      status: 'Approved'
    }
  ]);

  const [orderFilters, setOrderFilters] = useState({
    status: 'All',
    vendor: 'All',
    priority: 'All',
    search: ''
  });

  const [inventoryMeta, setInventoryMeta] = useState({
    lastUploadTime: '2026-02-28 4:12 PM',
    uploadNote: 'Inventory check uploaded successfully.'
  });

  const [selectedOrderId, setSelectedOrderId] = useState<string>(orders[0]?.id ?? '');

  const selectedOrder = useMemo(() => {
    return orders.find((order) => order.id === selectedOrderId) ?? null;
  }, [orders, selectedOrderId]);

  const vendorOptions = useMemo(() => vendors.map((vendor) => vendor.vendor), [vendors]);

  const onOrderQtyByProduct = useMemo(() => {
    const tally = new Map<string, number>();
    for (const order of orders) {
      if (!isOpenOrder(order.status)) continue;
      for (const line of order.lines) {
        tally.set(line.item, (tally.get(line.item) ?? 0) + line.qty);
      }
    }
    return tally;
  }, [orders]);

  const promptRows = useMemo<PromptRecord[]>(() => {
    return products
      .filter((product) => {
        const stockLow = product.stock === 0 || product.stock < product.reorderThreshold;
        const onOrder = onOrderQtyByProduct.get(product.name) ?? 0;
        return stockLow && onOrder === 0;
      })
      .map((product) => {
        const onOrder = onOrderQtyByProduct.get(product.name) ?? 0;
        const suggestedQty = Math.max(product.parLevel - (product.stock + onOrder), 0);
        return {
          productId: product.id,
          product: product.name,
          currentStock: product.stock,
          onOrder,
          suggestedQty,
          vendor: product.vendor,
          lastPrice: 8.75
        };
      });
  }, [products, onOrderQtyByProduct]);

  const lowStockProducts = useMemo(
    () => products.filter((product) => product.stock <= product.reorderThreshold),
    [products]
  );

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesStatus = orderFilters.status === 'All' || order.status === orderFilters.status;
      const matchesVendor = orderFilters.vendor === 'All' || order.vendor === orderFilters.vendor;
      const matchesPriority = orderFilters.priority === 'All' || order.priority === orderFilters.priority;
      const query = orderFilters.search.trim().toLowerCase();
      const matchesSearch = !query
        || [order.id, order.vendor, order.status, order.reason].join(' ').toLowerCase().includes(query);
      return matchesStatus && matchesVendor && matchesPriority && matchesSearch;
    });
  }, [orders, orderFilters]);

  const createOrderFromPrompt = (prompt: PromptRecord) => {
    const draftId = `PO-2026-00${Math.floor(Math.random() * 900 + 100)}`;
    const newOrder: OrderRecord = {
      id: draftId,
      vendor: prompt.vendor,
      status: 'Draft',
      datePlaced: new Date().toISOString().slice(0, 10),
      requestedDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString().slice(0, 10),
      priority: 'Normal',
      reason: `Reorder suggested from inventory upload: ${prompt.product}`,
      notes: 'Created from prompt.',
      lines: [
        {
          id: `line-${crypto.randomUUID()}`,
          item: prompt.product,
          qty: prompt.suggestedQty,
          unitPrice: prompt.lastPrice,
          link: '',
          notes: '',
          receivedQty: 0
        }
      ]
    };

    setOrders((previous) => [newOrder, ...previous]);
    setSelectedOrderId(newOrder.id);
    setActiveView('orders');
  };

  const dismissPrompt = (productId: string) => {
    setInventoryMeta((previous) => ({
      ...previous,
      uploadNote: `Prompt dismissed for ${products.find((item) => item.id === productId)?.name ?? 'item'}.`
    }));
  };

  const addOrderItem = () => {
    if (!selectedOrder) return;
    const nextLine: OrderLine = {
      id: `line-${crypto.randomUUID()}`,
      item: '',
      qty: 1,
      unitPrice: 0,
      link: '',
      notes: '',
      receivedQty: 0
    };
    setOrders((previous) =>
      previous.map((order) =>
        order.id === selectedOrder.id
          ? { ...order, lines: [...order.lines, nextLine] }
          : order
      )
    );
  };

  const updateSelectedOrder = (patch: Partial<OrderRecord>) => {
    if (!selectedOrder) return;
    setOrders((previous) => previous.map((order) => (order.id === selectedOrder.id ? { ...order, ...patch } : order)));
  };

  const updateSelectedLine = (lineId: string, patch: Partial<OrderLine>) => {
    if (!selectedOrder) return;
    setOrders((previous) =>
      previous.map((order) =>
        order.id !== selectedOrder.id
          ? order
          : {
              ...order,
              lines: order.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line))
            }
      )
    );
  };

  const removeSelectedLine = (lineId: string) => {
    if (!selectedOrder) return;
    setOrders((previous) =>
      previous.map((order) =>
        order.id !== selectedOrder.id
          ? order
          : {
              ...order,
              lines: order.lines.filter((line) => line.id !== lineId)
            }
      )
    );
  };

  const markReceiving = (mode: 'partial' | 'full') => {
    if (!selectedOrder) return;
    if (mode === 'full') {
      setOrders((previous) =>
        previous.map((order) =>
          order.id !== selectedOrder.id
            ? order
            : {
                ...order,
                status: 'Received',
                lines: order.lines.map((line) => ({ ...line, receivedQty: line.qty }))
              }
        )
      );
      return;
    }

    setOrders((previous) =>
      previous.map((order) => (order.id === selectedOrder.id ? { ...order, status: 'Partially Received' } : order))
    );
  };

  const onOpenOrderDetail = (orderId: string) => {
    setSelectedOrderId(orderId);
    setActiveView('order-detail');
  };

  const onNewOrder = () => {
    const newOrder: OrderRecord = {
      id: `PO-2026-00${Math.floor(Math.random() * 900 + 100)}`,
      vendor: vendorOptions[0] ?? 'Amazon',
      status: 'Draft',
      datePlaced: new Date().toISOString().slice(0, 10),
      requestedDate: new Date().toISOString().slice(0, 10),
      priority: 'Normal',
      reason: '',
      notes: '',
      lines: []
    };
    setOrders((previous) => [newOrder, ...previous]);
    setSelectedOrderId(newOrder.id);
    setActiveView('order-detail');
  };

  return (
    <main className="min-h-screen w-full text-neutral-900">
      <div className="grid min-h-screen w-full grid-cols-1 border border-neutral-300 bg-white md:grid-cols-[240px_1fr]">
        <aside className="w-full border-b border-neutral-300 bg-white md:min-h-screen md:border-b-0 md:border-r">
          <div className="border-b border-neutral-300 px-4 py-4">
            <h1 className="text-lg font-semibold">Product Dashboard</h1>
            <p className="mt-1 text-xs text-neutral-600">School Store Operations Portal</p>
          </div>
          <nav aria-label="Product navigation" className="p-0" role="tablist">
            {NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id || (item.id === 'orders' && activeView === 'order-detail');
              return (
                <button
                  aria-selected={isActive}
                  className={`flex min-h-[44px] w-full items-center justify-between border-b border-neutral-300 px-4 py-3 text-left text-sm font-medium ${
                    isActive
                      ? 'bg-brand-maroon text-white'
                      : 'bg-white text-neutral-800 hover:bg-neutral-50'
                  }`}
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  role="tab"
                  type="button"
                >
                  <span>{item.label}</span>
                  {item.id === 'prompts' && promptRows.length > 0 ? (
                    <span className="text-xs tabular-nums">{promptRows.length}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="w-full flex-1">
          {(activeView === 'orders' || activeView === 'order-detail') && (
            <section aria-labelledby="orders-heading" className="w-full">
              <header className="border-b border-neutral-300 bg-white px-4 py-4 md:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold" id="orders-heading">Orders</h2>
                    <div className="mt-2 text-sm leading-6 text-neutral-700">
                      <p>Requester: {settings.requester}</p>
                      <p>Activity Account: {settings.activityAccount}</p>
                      <p>Account #: {settings.accountNumber}</p>
                    </div>
                  </div>
                  <button
                    className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-4 text-sm font-medium text-white hover:bg-[#6a0000]"
                    onClick={onNewOrder}
                    type="button"
                  >
                    + New Order
                  </button>
                </div>
              </header>

              {activeView === 'orders' ? (
                <>
                  <section className="border-b border-neutral-300 bg-white px-4 py-3 md:px-6" aria-label="Order filters">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
                      <select
                        className="min-h-[38px] border border-neutral-300 bg-white px-2 text-sm"
                        onChange={(event) => setOrderFilters((previous) => ({ ...previous, status: event.target.value }))}
                        value={orderFilters.status}
                      >
                        <option>All</option>
                        {ORDER_STATUS_FLOW.map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </select>

                      <select
                        className="min-h-[38px] border border-neutral-300 bg-white px-2 text-sm"
                        onChange={(event) => setOrderFilters((previous) => ({ ...previous, vendor: event.target.value }))}
                        value={orderFilters.vendor}
                      >
                        <option>All</option>
                        {vendorOptions.map((vendor) => (
                          <option key={vendor}>{vendor}</option>
                        ))}
                      </select>

                      <input
                        aria-label="Date Range"
                        className="min-h-[38px] border border-neutral-300 bg-white px-2 text-sm"
                        placeholder="Date Range"
                        type="text"
                      />

                      <select
                        className="min-h-[38px] border border-neutral-300 bg-white px-2 text-sm"
                        onChange={(event) => setOrderFilters((previous) => ({ ...previous, priority: event.target.value }))}
                        value={orderFilters.priority}
                      >
                        <option>All</option>
                        <option>Normal</option>
                        <option>Urgent</option>
                      </select>

                      <input
                        className="min-h-[38px] border border-neutral-300 bg-white px-2 text-sm"
                        onChange={(event) => setOrderFilters((previous) => ({ ...previous, search: event.target.value }))}
                        placeholder="Search"
                        type="search"
                        value={orderFilters.search}
                      />
                    </div>
                    <p className="mt-2 text-xs text-neutral-600">Status • Vendor • Date Range • Priority • Search</p>
                  </section>

                  <div className="overflow-x-auto">
                    <table className="min-w-full bg-white text-sm">
                      <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                        <tr>
                          <th className="border-b border-neutral-300 px-4 py-3">Order #</th>
                          <th className="border-b border-neutral-300 px-4 py-3">Vendor</th>
                          <th className="border-b border-neutral-300 px-4 py-3">Status</th>
                          <th className="border-b border-neutral-300 px-4 py-3">Date Plcaed</th>
                          <th className="border-b border-neutral-300 px-4 py-3">Requested Date</th>
                          <th className="border-b border-neutral-300 px-4 py-3">Total</th>
                          <th className="border-b border-neutral-300 px-4 py-3">Priority</th>
                          <th className="border-b border-neutral-300 px-4 py-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrders.map((order) => (
                          <tr
                            className="border-b border-neutral-200 hover:bg-neutral-50 focus-within:bg-neutral-50"
                            key={order.id}
                          >
                            <td className="px-4 py-3 font-medium">
                              <button
                                className="underline-offset-2 hover:underline"
                                onClick={() => onOpenOrderDetail(order.id)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    onOpenOrderDetail(order.id);
                                  }
                                }}
                                tabIndex={0}
                                type="button"
                              >
                                {order.id}
                              </button>
                            </td>
                            <td className="px-4 py-3">{order.vendor}</td>
                            <td className="px-4 py-3">{order.status}</td>
                            <td className="px-4 py-3">{order.datePlaced}</td>
                            <td className="px-4 py-3">{order.requestedDate}</td>
                            <td className="px-4 py-3">{currency.format(orderTotal(order))}</td>
                            <td className="px-4 py-3">{order.priority}</td>
                            <td className="px-4 py-3">
                              <button
                                className="min-h-[32px] border border-neutral-300 px-3 text-xs hover:bg-neutral-100"
                                onClick={() => onOpenOrderDetail(order.id)}
                                type="button"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : selectedOrder ? (
                <div className="bg-white">
                  <section className="border-b border-neutral-300 px-4 py-4 md:px-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-base font-semibold">Order Detail / Edit: {selectedOrder.id}</h3>
                      <button
                        className="min-h-[36px] border border-neutral-300 px-3 text-sm hover:bg-neutral-100"
                        onClick={() => setActiveView('orders')}
                        type="button"
                      >
                        Back to Orders
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
                      <label className="text-sm text-neutral-700">
                        Vendor
                        <select
                          className="mt-1 min-h-[38px] w-full border border-neutral-300 bg-white px-2"
                          onChange={(event) => updateSelectedOrder({ vendor: event.target.value })}
                          value={selectedOrder.vendor}
                        >
                          {vendorOptions.map((vendor) => (
                            <option key={vendor}>{vendor}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm text-neutral-700">
                        Status
                        <select
                          className="mt-1 min-h-[38px] w-full border border-neutral-300 bg-white px-2"
                          onChange={(event) => updateSelectedOrder({ status: event.target.value as OrderStatus })}
                          value={selectedOrder.status}
                        >
                          {ORDER_STATUS_FLOW.map((status) => (
                            <option key={status}>{status}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm text-neutral-700">
                        Priority
                        <select
                          className="mt-1 min-h-[38px] w-full border border-neutral-300 bg-white px-2"
                          onChange={(event) => updateSelectedOrder({ priority: event.target.value as Priority })}
                          value={selectedOrder.priority}
                        >
                          <option>Normal</option>
                          <option>Urgent</option>
                        </select>
                      </label>

                      <label className="text-sm text-neutral-700">
                        Requested Date
                        <input
                          className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                          onChange={(event) => updateSelectedOrder({ requestedDate: event.target.value })}
                          type="date"
                          value={selectedOrder.requestedDate}
                        />
                      </label>
                      <label className="text-sm text-neutral-700 lg:col-span-2">
                        Reason
                        <input
                          className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                          onChange={(event) => updateSelectedOrder({ reason: event.target.value })}
                          type="text"
                          value={selectedOrder.reason}
                        />
                      </label>

                      <label className="text-sm text-neutral-700 lg:col-span-3">
                        Notes
                        <textarea
                          className="mt-1 min-h-[86px] w-full border border-neutral-300 px-2 py-2"
                          onChange={(event) => updateSelectedOrder({ notes: event.target.value })}
                          value={selectedOrder.notes}
                        />
                      </label>
                    </div>
                  </section>

                  <section className="border-b border-neutral-300 px-4 py-4 md:px-6">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-base font-semibold">Line Items</h3>
                      <button
                        className="min-h-[36px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000]"
                        onClick={addOrderItem}
                        type="button"
                      >
                        + Add Item
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                          <tr>
                            <th className="border-b border-neutral-300 px-3 py-2">Item</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Qty</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Unit Price</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Total</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Link</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Notes</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Remove</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedOrder.lines.map((line) => (
                            <tr className="border-b border-neutral-200" key={line.id}>
                              <td className="px-3 py-2">
                                <input
                                  className="min-h-[34px] w-full border border-neutral-300 px-2"
                                  onChange={(event) => updateSelectedLine(line.id, { item: event.target.value })}
                                  type="text"
                                  value={line.item}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  className="min-h-[34px] w-20 border border-neutral-300 px-2"
                                  min={0}
                                  onChange={(event) => updateSelectedLine(line.id, { qty: Number(event.target.value) })}
                                  type="number"
                                  value={line.qty}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  className="min-h-[34px] w-24 border border-neutral-300 px-2"
                                  min={0}
                                  onChange={(event) =>
                                    updateSelectedLine(line.id, { unitPrice: Number(event.target.value) })
                                  }
                                  step="0.01"
                                  type="number"
                                  value={line.unitPrice}
                                />
                              </td>
                              <td className="px-3 py-2 font-medium">{currency.format(lineTotal(line))}</td>
                              <td className="px-3 py-2">
                                <input
                                  className="min-h-[34px] w-full border border-neutral-300 px-2"
                                  onChange={(event) => updateSelectedLine(line.id, { link: event.target.value })}
                                  type="url"
                                  value={line.link}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  className="min-h-[34px] w-full border border-neutral-300 px-2"
                                  onChange={(event) => updateSelectedLine(line.id, { notes: event.target.value })}
                                  type="text"
                                  value={line.notes}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  className="min-h-[34px] border border-red-700 px-2 text-xs text-red-700 hover:bg-red-50"
                                  onClick={() => removeSelectedLine(line.id)}
                                  type="button"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-neutral-50">
                            <td className="px-3 py-3 font-semibold" colSpan={3}>
                              Order Total
                            </td>
                            <td className="px-3 py-3 font-semibold">{currency.format(orderTotal(selectedOrder))}</td>
                            <td className="px-3 py-3" colSpan={3} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </section>

                  <section className="border-b border-neutral-300 px-4 py-4 md:px-6">
                    <h3 className="text-base font-semibold">Attachments</h3>
                    <label className="mt-3 block border border-dashed border-neutral-400 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-600">
                      Drag &amp; drop upload zone (Receipt, quote, screenshots)
                      <input className="sr-only" multiple type="file" />
                    </label>
                  </section>

                  <section className="px-4 py-4 md:px-6">
                    <h3 className="text-base font-semibold">Receiving</h3>
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                          <tr>
                            <th className="border-b border-neutral-300 px-3 py-2">Item</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Ordered Qty</th>
                            <th className="border-b border-neutral-300 px-3 py-2">Received Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedOrder.lines.map((line) => (
                            <tr className="border-b border-neutral-200" key={`${line.id}-receive`}>
                              <td className="px-3 py-2">{line.item || 'Unspecified item'}</td>
                              <td className="px-3 py-2">{line.qty}</td>
                              <td className="px-3 py-2">
                                <input
                                  className="min-h-[34px] w-24 border border-neutral-300 px-2"
                                  max={line.qty}
                                  min={0}
                                  onChange={(event) =>
                                    updateSelectedLine(line.id, { receivedQty: Number(event.target.value) })
                                  }
                                  type="number"
                                  value={line.receivedQty}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        className="min-h-[36px] border border-neutral-800 px-3 text-sm hover:bg-neutral-100"
                        onClick={() => markReceiving('partial')}
                        type="button"
                      >
                        Mark Partially Received
                      </button>
                      <button
                        className="min-h-[36px] border border-emerald-700 bg-emerald-700 px-3 text-sm text-white hover:bg-emerald-800"
                        onClick={() => markReceiving('full')}
                        type="button"
                      >
                        Mark Fully Received
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}
            </section>
          )}

          {activeView === 'prompts' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Prompts</h2>
                <p className="mt-1 text-sm text-neutral-600">Reorder suggestions generated after inventory upload.</p>
              </header>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                    <tr>
                      <th className="border-b border-neutral-300 px-4 py-3">Product</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Current Stock</th>
                      <th className="border-b border-neutral-300 px-4 py-3">On Order</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Suggested Qty</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Vendor</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Last Price</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promptRows.map((prompt) => (
                      <tr className="border-b border-neutral-200" key={prompt.productId}>
                        <td className="px-4 py-3 font-medium">{prompt.product}</td>
                        <td className="px-4 py-3">{prompt.currentStock}</td>
                        <td className="px-4 py-3">{prompt.onOrder}</td>
                        <td className="px-4 py-3">{prompt.suggestedQty}</td>
                        <td className="px-4 py-3">{prompt.vendor}</td>
                        <td className="px-4 py-3">{currency.format(prompt.lastPrice)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="min-h-[32px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white hover:bg-[#6a0000]"
                              onClick={() => createOrderFromPrompt(prompt)}
                              type="button"
                            >
                              Create Order
                            </button>
                            <button
                              className="min-h-[32px] border border-neutral-300 px-3 text-xs hover:bg-neutral-100"
                              onClick={() => dismissPrompt(prompt.productId)}
                              type="button"
                            >
                              Dismiss
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeView === 'inventory' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Inventory</h2>
              </header>

              <section className="border-b border-neutral-300 bg-white px-4 py-3 text-sm md:px-6">
                <p>
                  <span className="font-medium">Last upload time:</span> {inventoryMeta.lastUploadTime}
                </p>
                <p className="mt-1 text-neutral-600">{inventoryMeta.uploadNote}</p>
                <label className="mt-3 inline-flex min-h-[36px] cursor-pointer items-center border border-neutral-400 bg-white px-3 text-xs font-medium hover:bg-neutral-100">
                  Upload Inventory Check
                  <input
                    className="sr-only"
                    onChange={() =>
                      setInventoryMeta({
                        lastUploadTime: new Date().toLocaleString(),
                        uploadNote: 'Inventory check uploaded. Reorder prompts updated using threshold logic.'
                      })
                    }
                    type="file"
                  />
                </label>
              </section>

              <section className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h3 className="text-base font-semibold">Low Stock List</h3>
                <ul className="mt-2 space-y-1 text-sm text-neutral-700">
                  {lowStockProducts.map((product) => (
                    <li key={product.id}>
                      {product.name}: {product.stock} on hand (threshold {product.reorderThreshold})
                    </li>
                  ))}
                </ul>
              </section>

              <section className="px-4 py-4 md:px-6">
                <h3 className="mb-2 text-base font-semibold">Stock Counts</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                      <tr>
                        <th className="border-b border-neutral-300 px-3 py-2">Product</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Current Stock</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Reorder Threshold</th>
                        <th className="border-b border-neutral-300 px-3 py-2">Par Level</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((product) => (
                        <tr className="border-b border-neutral-200" key={product.id}>
                          <td className="px-3 py-2">{product.name}</td>
                          <td className="px-3 py-2">{product.stock}</td>
                          <td className="px-3 py-2">{product.reorderThreshold}</td>
                          <td className="px-3 py-2">{product.parLevel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </section>
          )}

          {activeView === 'products' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Products (Catalog)</h2>
              </header>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                    <tr>
                      <th className="border-b border-neutral-300 px-4 py-3">Product</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Category</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Vendor</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Stock</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Reorder Threshold</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Par Level</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => (
                      <tr className="border-b border-neutral-200" key={product.id}>
                        <td className="px-4 py-3">{product.name}</td>
                        <td className="px-4 py-3">{product.category}</td>
                        <td className="px-4 py-3">{product.vendor}</td>
                        <td className="px-4 py-3">{product.stock}</td>
                        <td className="px-4 py-3">{product.reorderThreshold}</td>
                        <td className="px-4 py-3">{product.parLevel}</td>
                        <td className="px-4 py-3">
                          <button className="min-h-[32px] border border-neutral-300 px-3 text-xs hover:bg-neutral-100" type="button">
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeView === 'vendors' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Vendors</h2>
                <p className="mt-1 text-sm text-neutral-600">Default vendors are preloaded and editable inline.</p>
              </header>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                    <tr>
                      <th className="border-b border-neutral-300 px-4 py-3">Vendor</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Ordering Method</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Lead Time</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.map((vendor) => (
                      <tr className="border-b border-neutral-200" key={vendor.id}>
                        <td className="px-4 py-3">
                          <input
                            className="min-h-[34px] w-full border border-neutral-300 px-2"
                            onChange={(event) =>
                              setVendors((previous) =>
                                previous.map((entry) =>
                                  entry.id === vendor.id ? { ...entry, vendor: event.target.value } : entry
                                )
                              )
                            }
                            type="text"
                            value={vendor.vendor}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <select
                            className="min-h-[34px] w-full border border-neutral-300 bg-white px-2"
                            onChange={(event) =>
                              setVendors((previous) =>
                                previous.map((entry) =>
                                  entry.id === vendor.id
                                    ? {
                                        ...entry,
                                        orderingMethod: event.target.value as VendorRecord['orderingMethod']
                                      }
                                    : entry
                                )
                              )
                            }
                            value={vendor.orderingMethod}
                          >
                            <option>Online</option>
                            <option>In-Store</option>
                            <option>Phone</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            className="min-h-[34px] w-24 border border-neutral-300 px-2"
                            min={0}
                            onChange={(event) =>
                              setVendors((previous) =>
                                previous.map((entry) =>
                                  entry.id === vendor.id ? { ...entry, leadTime: Number(event.target.value) } : entry
                                )
                              )
                            }
                            type="number"
                            value={vendor.leadTime}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            className="min-h-[34px] w-full border border-neutral-300 px-2"
                            onChange={(event) =>
                              setVendors((previous) =>
                                previous.map((entry) =>
                                  entry.id === vendor.id ? { ...entry, notes: event.target.value } : entry
                                )
                              )
                            }
                            type="text"
                            value={vendor.notes}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeView === 'designs' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Designs</h2>
                <p className="mt-1 text-sm text-neutral-600">Full-width design rows with front and back previews.</p>
              </header>

              <section className="space-y-3 bg-neutral-100 px-4 py-4 md:px-6">
                {designs.map((design) => (
                  <article className="border border-neutral-300 bg-white" key={design.id}>
                    <div className="grid grid-cols-1 gap-0 border-b border-neutral-300 md:grid-cols-6">
                      <div className="border-b border-neutral-300 bg-neutral-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 md:border-b-0 md:border-r">
                        Front
                      </div>
                      <div className="min-h-[110px] border-b border-neutral-300 bg-neutral-100 md:border-b-0 md:border-r" />
                      <div className="border-b border-neutral-300 bg-neutral-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 md:border-b-0 md:border-r">
                        Back
                      </div>
                      <div className="min-h-[110px] border-b border-neutral-300 bg-neutral-100 md:border-b-0 md:border-r" />
                      <div className="px-3 py-3 md:border-r md:border-neutral-300">
                        <p className="text-xs text-neutral-500">Name</p>
                        <p className="text-sm font-medium">{design.name}</p>
                      </div>
                      <div className="px-3 py-3">
                        <p className="text-xs text-neutral-500">Priority / Status</p>
                        <p className="text-sm font-medium">
                          {design.priority} / {design.status}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            </section>
          )}

          {activeView === 'wishlist' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Wishlist</h2>
              </header>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                    <tr>
                      <th className="border-b border-neutral-300 px-4 py-3">Item</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Vendor</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Estimated Cost</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Priority</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Status</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Convert →</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wishlist.map((item) => (
                      <tr className="border-b border-neutral-200" key={item.id}>
                        <td className="px-4 py-3">{item.item}</td>
                        <td className="px-4 py-3">{item.vendor}</td>
                        <td className="px-4 py-3">{currency.format(item.estimatedCost)}</td>
                        <td className="px-4 py-3">{item.priority}</td>
                        <td className="px-4 py-3">{item.status}</td>
                        <td className="px-4 py-3">
                          <button className="min-h-[32px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white hover:bg-[#6a0000]" type="button">
                            Convert
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeView === 'settings' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Settings</h2>
                <p className="mt-1 text-sm text-neutral-600">Update default values for new order headers.</p>
              </header>
              <section className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-3 md:px-6">
                <label className="text-sm text-neutral-700">
                  Requester default
                  <input
                    className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                    onChange={(event) => setSettings((previous) => ({ ...previous, requester: event.target.value }))}
                    type="text"
                    value={settings.requester}
                  />
                </label>
                <label className="text-sm text-neutral-700">
                  Activity account
                  <input
                    className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                    onChange={(event) =>
                      setSettings((previous) => ({ ...previous, activityAccount: event.target.value }))
                    }
                    type="text"
                    value={settings.activityAccount}
                  />
                </label>
                <label className="text-sm text-neutral-700">
                  Account number
                  <input
                    className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                    onChange={(event) =>
                      setSettings((previous) => ({ ...previous, accountNumber: event.target.value }))
                    }
                    type="text"
                    value={settings.accountNumber}
                  />
                </label>
              </section>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
