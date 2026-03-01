'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';

import { createBrowserClient } from '@/lib/supabase';

type DashboardView = 'orders' | 'prompts' | 'products' | 'vendors' | 'designs' | 'wishlist' | 'settings';

type DbOrderStatus = 'draft' | 'submitted' | 'approved' | 'ordered' | 'partially_received' | 'received' | 'archived' | 'cancelled';
type DbPriority = 'normal' | 'urgent';
type DbOrderingMethod = 'online' | 'in_store' | 'phone' | 'other';
type DbPromptStatus = 'open' | 'dismissed' | 'converted';
type DbDesignPriority = 'low' | 'normal' | 'high';
type DbDesignStatus = 'idea' | 'review' | 'approved' | 'ready_to_order' | 'archived';
type DbWishlistStatus = 'backlog' | 'researching' | 'approved' | 'converted' | 'archived';

interface ProductRow {
  id: string;
  name: string;
  category: string | null;
  preferred_vendor_id: string | null;
  vendor_product_link: string | null;
  default_unit_cost: number | null;
  retail_price: number | null;
  sku: string | null;
  barcode_upc: string | null;
  is_active: boolean;
}

interface VendorRow {
  id: string;
  name: string;
  ordering_method: DbOrderingMethod;
  default_link: string | null;
  notes: string | null;
  is_active: boolean;
}

interface OrderLineRow {
  id: string;
  purchase_order_id: string;
  product_id: string | null;
  custom_item_name: string | null;
  quantity: number;
  unit_price: number;
  product_link: string | null;
  notes: string | null;
}

interface OrderRow {
  id: string;
  order_number: string;
  requester_name: string;
  activity_account: string;
  account_number: string;
  vendor_id: string;
  status: DbOrderStatus;
  reason: string | null;
  priority: DbPriority;
  date_placed: string | null;
  requested_pickup_date: string | null;
  expected_arrival_date: string | null;
  asap: boolean;
  notes: string | null;
  total_amount: number;
  lines: OrderLineRow[];
}

interface PromptRow {
  id: string;
  inventory_upload_id: string;
  product_id: string;
  current_stock: number;
  on_order_qty: number;
  suggested_qty: number;
  vendor_id: string | null;
  last_price: number | null;
  status: DbPromptStatus;
  converted_purchase_order_id: string | null;
  created_at: string;
}

interface DesignRow {
  id: string;
  name: string;
  category: string | null;
  status: DbDesignStatus;
  priority: DbDesignPriority;
  preferred_vendor_id: string | null;
  estimated_cost: number | null;
  front_attachment_id: string | null;
  back_attachment_id: string | null;
  notes: string | null;
}

interface AttachmentRow {
  id: string;
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
}

interface WishlistRow {
  id: string;
  item_name: string;
  category: string | null;
  vendor_id: string | null;
  estimated_cost: number | null;
  priority: DbDesignPriority;
  status: DbWishlistStatus;
  notes: string | null;
  converted_purchase_order_id: string | null;
  converted_design_id: string | null;
  converted_product_id: string | null;
}

const NAV_ITEMS: Array<{ id: DashboardView; label: string }> = [
  { id: 'orders', label: 'Orders' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'products', label: 'Products' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'designs', label: 'Designs' },
  { id: 'wishlist', label: 'Wishlist' },
  { id: 'settings', label: 'Settings' }
];

const ORDER_STATUSES: DbOrderStatus[] = [
  'draft',
  'submitted',
  'approved',
  'ordered',
  'partially_received',
  'received',
  'archived',
  'cancelled'
];

const DESIGN_STATUSES: DbDesignStatus[] = ['idea', 'review', 'approved', 'ready_to_order', 'archived'];
const PRIORITIES: DbDesignPriority[] = ['low', 'normal', 'high'];
const WISHLIST_STATUSES: DbWishlistStatus[] = ['backlog', 'researching', 'approved', 'converted', 'archived'];
const ORDERING_METHODS: DbOrderingMethod[] = ['online', 'in_store', 'phone', 'other'];

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

function formatLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function generateOrderNumber() {
  const now = new Date();
  return `PO-${now.getFullYear()}-${Math.floor(now.getTime() / 1000)}`;
}

export function ProductDashboard() {
  const supabase = useMemo(() => createBrowserClient(), []);

  const [activeView, setActiveView] = useState<DashboardView>('orders');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({});
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [wishlist, setWishlist] = useState<WishlistRow[]>([]);

  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const [orderFilters, setOrderFilters] = useState({
    status: 'all',
    vendor: 'all',
    priority: 'all',
    search: ''
  });

  const [inventoryNote, setInventoryNote] = useState('');
  const [inventoryQuantities, setInventoryQuantities] = useState<Record<string, string>>({});

  const [newProduct, setNewProduct] = useState({
    name: '',
    category: '',
    preferred_vendor_id: '',
    sku: '',
    vendor_product_link: '',
    default_unit_cost: '',
    retail_price: ''
  });

  const [newVendor, setNewVendor] = useState({
    name: '',
    ordering_method: 'online' as DbOrderingMethod,
    default_link: '',
    notes: ''
  });

  const [newWishlistItem, setNewWishlistItem] = useState({
    item_name: '',
    category: '',
    vendor_id: '',
    estimated_cost: '',
    priority: 'normal' as DbDesignPriority,
    status: 'backlog' as DbWishlistStatus,
    notes: ''
  });

  const [newDesign, setNewDesign] = useState({
    name: '',
    category: '',
    preferred_vendor_id: '',
    priority: 'normal' as DbDesignPriority,
    status: 'idea' as DbDesignStatus,
    estimated_cost: '',
    description: '',
    frontFile: null as File | null,
    backFile: null as File | null
  });

  const vendorById = useMemo(() => {
    const map = new Map<string, VendorRow>();
    vendors.forEach((vendor) => map.set(vendor.id, vendor));
    return map;
  }, [vendors]);

  const productById = useMemo(() => {
    const map = new Map<string, ProductRow>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const attachmentById = useMemo(() => {
    const map = new Map<string, AttachmentRow>();
    attachments.forEach((attachment) => map.set(attachment.id, attachment));
    return map;
  }, [attachments]);

  const promptCount = useMemo(() => prompts.filter((prompt) => prompt.status === 'open').length, [prompts]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [
      settingsResult,
      vendorsResult,
      productsResult,
      ordersResult,
      linesResult,
      promptsResult,
      designsResult,
      attachmentsResult,
      wishlistResult
    ] = await Promise.all([
      supabase.from('product_settings').select('key,value'),
      supabase
        .from('product_vendors')
        .select('id,name,ordering_method,default_link,notes,is_active')
        .order('name', { ascending: true }),
      supabase
        .from('product_products')
        .select('id,name,category,preferred_vendor_id,vendor_product_link,default_unit_cost,retail_price,sku,barcode_upc,is_active')
        .eq('is_active', true)
        .order('category', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('product_purchase_orders')
        .select('id,order_number,requester_name,activity_account,account_number,vendor_id,status,reason,priority,date_placed,requested_pickup_date,expected_arrival_date,asap,notes,total_amount')
        .order('created_at', { ascending: false }),
      supabase
        .from('product_purchase_order_lines')
        .select('id,purchase_order_id,product_id,custom_item_name,quantity,unit_price,product_link,notes')
        .order('id', { ascending: true }),
      supabase
        .from('product_order_prompts')
        .select('id,inventory_upload_id,product_id,current_stock,on_order_qty,suggested_qty,vendor_id,last_price,status,converted_purchase_order_id,created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false }),
      supabase
        .from('product_designs')
        .select('id,name,category,status,priority,preferred_vendor_id,estimated_cost,front_attachment_id,back_attachment_id,notes')
        .order('created_at', { ascending: false }),
      supabase
        .from('product_attachments')
        .select('id,bucket,storage_path,file_name,mime_type,size_bytes')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('product_wishlist_items')
        .select('id,item_name,category,vendor_id,estimated_cost,priority,status,notes,converted_purchase_order_id,converted_design_id,converted_product_id')
        .order('created_at', { ascending: false })
    ]);

    const firstError = [
      settingsResult.error,
      vendorsResult.error,
      productsResult.error,
      ordersResult.error,
      linesResult.error,
      promptsResult.error,
      designsResult.error,
      attachmentsResult.error,
      wishlistResult.error
    ].find(Boolean);

    if (firstError) {
      setError((firstError as { message?: string }).message ?? 'Failed to load product dashboard data.');
      setLoading(false);
      return;
    }

    const settingsData = (settingsResult.data ?? []) as Array<{ key: string; value: string }>;
    const nextSettings: Record<string, string> = {};
    settingsData.forEach((entry) => {
      nextSettings[entry.key] = entry.value;
    });

    const lineRows = (linesResult.data ?? []) as OrderLineRow[];
    const linesByOrder = new Map<string, OrderLineRow[]>();
    for (const line of lineRows) {
      const bucket = linesByOrder.get(line.purchase_order_id) ?? [];
      bucket.push({
        ...line,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price)
      });
      linesByOrder.set(line.purchase_order_id, bucket);
    }

    const orderRows = ((ordersResult.data ?? []) as OrderRow[]).map((order) => ({
      ...order,
      total_amount: Number(order.total_amount ?? 0),
      lines: linesByOrder.get(order.id) ?? []
    }));

    setSettingsMap(nextSettings);
    setVendors(((vendorsResult.data ?? []) as VendorRow[]).filter((vendor) => vendor.is_active));
    setProducts(
      ((productsResult.data ?? []) as ProductRow[]).map((product) => ({
        ...product,
        default_unit_cost: product.default_unit_cost === null ? null : Number(product.default_unit_cost),
        retail_price: product.retail_price === null ? null : Number(product.retail_price)
      }))
    );
    setOrders(orderRows);
    setPrompts(
      ((promptsResult.data ?? []) as PromptRow[]).map((prompt) => ({
        ...prompt,
        current_stock: Number(prompt.current_stock),
        on_order_qty: Number(prompt.on_order_qty),
        suggested_qty: Number(prompt.suggested_qty),
        last_price: prompt.last_price === null ? null : Number(prompt.last_price)
      }))
    );
    setDesigns(
      ((designsResult.data ?? []) as DesignRow[]).map((design) => ({
        ...design,
        estimated_cost: design.estimated_cost === null ? null : Number(design.estimated_cost)
      }))
    );
    setAttachments((attachmentsResult.data ?? []) as AttachmentRow[]);
    setWishlist(
      ((wishlistResult.data ?? []) as WishlistRow[]).map((item) => ({
        ...item,
        estimated_cost: item.estimated_cost === null ? null : Number(item.estimated_cost)
      }))
    );

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (orderFilters.status !== 'all' && order.status !== orderFilters.status) return false;
      if (orderFilters.priority !== 'all' && order.priority !== orderFilters.priority) return false;
      if (orderFilters.vendor !== 'all' && order.vendor_id !== orderFilters.vendor) return false;
      const query = orderFilters.search.trim().toLowerCase();
      if (!query) return true;
      const vendorName = vendorById.get(order.vendor_id)?.name ?? '';
      return [order.order_number, vendorName, order.reason ?? '', order.notes ?? ''].join(' ').toLowerCase().includes(query);
    });
  }, [orders, orderFilters, vendorById]);

  const productsByCategory = useMemo(() => {
    const grouped = new Map<string, ProductRow[]>();
    for (const product of products) {
      const key = product.category?.trim() || 'Uncategorized';
      const current = grouped.get(key) ?? [];
      current.push(product);
      grouped.set(key, current);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [products]);

  const withSaveState = useCallback(async (work: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      setError(message);
    } finally {
      setSaving(false);
    }
  }, []);

  const saveSetting = async (key: string, value: string) => {
    await withSaveState(async () => {
      const { error: upsertError } = await supabase
        .from('product_settings')
        .upsert({ key, value, updated_by: 'dashboard' }, { onConflict: 'key' });
      if (upsertError) throw upsertError;
      setSettingsMap((prev) => ({ ...prev, [key]: value }));
      setNotice('Settings saved.');
    });
  };

  const saveVendor = async (vendor: VendorRow) => {
    await withSaveState(async () => {
      const { error: updateError } = await supabase
        .from('product_vendors')
        .update({
          name: vendor.name,
          ordering_method: vendor.ordering_method,
          default_link: vendor.default_link,
          notes: vendor.notes,
          updated_by: 'dashboard'
        })
        .eq('id', vendor.id);
      if (updateError) throw updateError;
      setNotice('Vendor saved.');
    });
  };

  const addVendor = async () => {
    if (!newVendor.name.trim()) {
      setError('Vendor name is required.');
      return;
    }

    await withSaveState(async () => {
      const { error: insertError } = await supabase.from('product_vendors').insert({
        name: newVendor.name.trim(),
        ordering_method: newVendor.ordering_method,
        default_link: newVendor.default_link.trim() || null,
        notes: newVendor.notes.trim() || null,
        updated_by: 'dashboard'
      });
      if (insertError) throw insertError;
      setNewVendor({ name: '', ordering_method: 'online', default_link: '', notes: '' });
      await loadDashboard();
      setNotice('Vendor added.');
    });
  };

  const saveProduct = async (product: ProductRow) => {
    await withSaveState(async () => {
      const { error: updateError } = await supabase
        .from('product_products')
        .update({
          name: product.name,
          category: product.category,
          preferred_vendor_id: product.preferred_vendor_id,
          vendor_product_link: product.vendor_product_link,
          default_unit_cost: product.default_unit_cost,
          retail_price: product.retail_price,
          sku: product.sku,
          barcode_upc: product.barcode_upc,
          updated_by: 'dashboard'
        })
        .eq('id', product.id);
      if (updateError) throw updateError;
      setNotice('Product saved.');
    });
  };

  const addProduct = async () => {
    if (!newProduct.name.trim()) {
      setError('Product name is required.');
      return;
    }

    await withSaveState(async () => {
      const { error: insertError } = await supabase.from('product_products').insert({
        name: newProduct.name.trim(),
        category: newProduct.category.trim() || null,
        preferred_vendor_id: newProduct.preferred_vendor_id || null,
        sku: newProduct.sku.trim() || null,
        vendor_product_link: newProduct.vendor_product_link.trim() || null,
        default_unit_cost: newProduct.default_unit_cost ? Number(newProduct.default_unit_cost) : null,
        retail_price: newProduct.retail_price ? Number(newProduct.retail_price) : null,
        updated_by: 'dashboard'
      });
      if (insertError) throw insertError;
      setNewProduct({
        name: '',
        category: '',
        preferred_vendor_id: '',
        sku: '',
        vendor_product_link: '',
        default_unit_cost: '',
        retail_price: ''
      });
      await loadDashboard();
      setNotice('Product added.');
    });
  };

  const createOrder = async () => {
    await withSaveState(async () => {
      const fallbackVendor = vendors[0]?.id;
      if (!fallbackVendor) throw new Error('Create a vendor first.');
      const requester = settingsMap['order.requester_default'] ?? '';
      const activity = settingsMap['order.activity_account_default'] ?? '';
      const account = settingsMap['order.account_number_default'] ?? '';

      const { data, error: insertError } = await supabase
        .from('product_purchase_orders')
        .insert({
          order_number: generateOrderNumber(),
          requester_name: requester,
          activity_account: activity,
          account_number: account,
          vendor_id: fallbackVendor,
          status: 'draft',
          priority: 'normal',
          date_placed: new Date().toISOString().slice(0, 10),
          requested_pickup_date: new Date().toISOString().slice(0, 10),
          updated_by: 'dashboard'
        })
        .select('id')
        .single();
      if (insertError) throw insertError;
      await loadDashboard();
      if (data?.id) {
        setExpandedOrderId(data.id);
      }
      setNotice('Order created.');
    });
  };

  const saveOrderHeader = async (order: OrderRow) => {
    await withSaveState(async () => {
      const { error: updateError } = await supabase
        .from('product_purchase_orders')
        .update({
          requester_name: order.requester_name,
          activity_account: order.activity_account,
          account_number: order.account_number,
          vendor_id: order.vendor_id,
          status: order.status,
          reason: order.reason,
          priority: order.priority,
          date_placed: order.date_placed,
          requested_pickup_date: order.requested_pickup_date,
          expected_arrival_date: order.expected_arrival_date,
          asap: order.asap,
          notes: order.notes,
          updated_by: 'dashboard'
        })
        .eq('id', order.id);
      if (updateError) throw updateError;
      setNotice(`Order ${order.order_number} saved.`);
      await loadDashboard();
    });
  };

  const addOrderLine = async (orderId: string) => {
    await withSaveState(async () => {
      const { error: insertError } = await supabase.from('product_purchase_order_lines').insert({
        purchase_order_id: orderId,
        custom_item_name: 'New item',
        quantity: 1,
        unit_price: 0,
        notes: null
      });
      if (insertError) throw insertError;
      await loadDashboard();
      setNotice('Line added.');
    });
  };

  const saveOrderLine = async (line: OrderLineRow) => {
    await withSaveState(async () => {
      const hasNamedProduct = !!line.product_id;
      const customName = (line.custom_item_name ?? '').trim();
      if (!hasNamedProduct && !customName) {
        throw new Error('Line item must have either a product or a custom item name.');
      }

      const { error: updateError } = await supabase
        .from('product_purchase_order_lines')
        .update({
          product_id: line.product_id,
          custom_item_name: customName || null,
          quantity: line.quantity,
          unit_price: line.unit_price,
          product_link: line.product_link,
          notes: line.notes
        })
        .eq('id', line.id);
      if (updateError) throw updateError;
      await loadDashboard();
      setNotice('Order line saved.');
    });
  };

  const removeOrderLine = async (lineId: string) => {
    await withSaveState(async () => {
      const { error: deleteError } = await supabase.from('product_purchase_order_lines').delete().eq('id', lineId);
      if (deleteError) throw deleteError;
      await loadDashboard();
      setNotice('Order line removed.');
    });
  };

  const generatePromptsFromUpload = useCallback(
    async (inventoryUploadId: string, counts: Array<{ product_id: string; quantity: number }>) => {
      const cutoffRaw = settingsMap['prompt.low_stock_cutoff'];
      const lowStockCutoff = Number.isFinite(Number(cutoffRaw)) ? Number(cutoffRaw) : 2;

      const openStatuses: DbOrderStatus[] = ['draft', 'submitted', 'approved', 'ordered', 'partially_received'];
      const { data: openOrderLines, error: openOrderLinesError } = await supabase
        .from('product_purchase_order_lines')
        .select('product_id,quantity,purchase_order:product_purchase_orders(status)')
        .not('product_id', 'is', null);
      if (openOrderLinesError) throw openOrderLinesError;

      const onOrderByProduct = new Map<string, number>();
      type OpenOrderLine = {
        product_id: string | null;
        quantity: number;
        purchase_order: Array<{ status: DbOrderStatus }> | { status: DbOrderStatus } | null;
      };
      for (const row of (openOrderLines ?? []) as OpenOrderLine[]) {
        const productId = row.product_id;
        const joinedOrder = Array.isArray(row.purchase_order) ? row.purchase_order[0] : row.purchase_order;
        const status = joinedOrder?.status;
        if (!productId || !status || !openStatuses.includes(status)) continue;
        onOrderByProduct.set(productId, (onOrderByProduct.get(productId) ?? 0) + Number(row.quantity));
      }

      await supabase.from('product_order_prompts').update({ status: 'dismissed' }).eq('status', 'open');

      const promptRows = counts
        .map((entry) => {
          const product = productById.get(entry.product_id);
          if (!product) return null;
          const onOrderQty = onOrderByProduct.get(entry.product_id) ?? 0;
          const isLow = entry.quantity <= lowStockCutoff;
          if (!isLow) return null;

          const suggestedQty = Math.max(lowStockCutoff + 1 - (entry.quantity + onOrderQty), 1);
          return {
            inventory_upload_id: inventoryUploadId,
            product_id: entry.product_id,
            current_stock: entry.quantity,
            on_order_qty: onOrderQty,
            suggested_qty: suggestedQty,
            vendor_id: product.preferred_vendor_id,
            last_price: product.default_unit_cost,
            status: 'open' as DbPromptStatus
          };
        })
        .filter(Boolean);

      if (promptRows.length > 0) {
        const { error: insertPromptError } = await supabase.from('product_order_prompts').insert(promptRows);
        if (insertPromptError) throw insertPromptError;
      }
    },
    [settingsMap, supabase, productById]
  );

  const submitInventoryCounts = async () => {
    const rows = Object.entries(inventoryQuantities)
      .map(([productId, rawQty]) => ({ product_id: productId, quantity: Number(rawQty) }))
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity >= 0);

    if (!rows.length) {
      setError('Enter at least one quantity before submitting inventory count.');
      return;
    }

    await withSaveState(async () => {
      const { data: uploadRow, error: uploadError } = await supabase
        .from('product_inventory_uploads')
        .insert({ source: 'manual_count', notes: inventoryNote.trim() || null, uploaded_by: 'dashboard' })
        .select('id')
        .single();
      if (uploadError) throw uploadError;

      const inventoryUploadId = uploadRow?.id;
      if (!inventoryUploadId) throw new Error('Upload id was not returned.');

      const { error: snapshotError } = await supabase.from('product_inventory_snapshot_lines').insert(
        rows.map((entry) => ({
          inventory_upload_id: inventoryUploadId,
          product_id: entry.product_id,
          quantity: entry.quantity
        }))
      );
      if (snapshotError) throw snapshotError;

      const { error: levelError } = await supabase.from('product_inventory_levels').upsert(
        rows.map((entry) => ({
          product_id: entry.product_id,
          quantity_on_hand: entry.quantity,
          last_inventory_upload_id: inventoryUploadId,
          updated_at: new Date().toISOString()
        })),
        { onConflict: 'product_id' }
      );
      if (levelError) throw levelError;

      await generatePromptsFromUpload(inventoryUploadId, rows);
      setInventoryQuantities({});
      setInventoryNote('');
      await loadDashboard();
      setNotice('Inventory count submitted and prompts updated.');
    });
  };

  const convertPromptToOrder = async (prompt: PromptRow) => {
    await withSaveState(async () => {
      const product = productById.get(prompt.product_id);
      if (!product) throw new Error('Prompt product not found.');
      const vendorId = prompt.vendor_id ?? product.preferred_vendor_id ?? vendors[0]?.id;
      if (!vendorId) throw new Error('No vendor available for conversion.');

      const requester = settingsMap['order.requester_default'] ?? '';
      const activity = settingsMap['order.activity_account_default'] ?? '';
      const account = settingsMap['order.account_number_default'] ?? '';

      const { data: orderRow, error: orderError } = await supabase
        .from('product_purchase_orders')
        .insert({
          order_number: generateOrderNumber(),
          requester_name: requester,
          activity_account: activity,
          account_number: account,
          vendor_id: vendorId,
          status: 'draft',
          priority: 'normal',
          reason: `Converted from prompt: ${product.name}`,
          notes: 'Converted from reorder prompt',
          date_placed: new Date().toISOString().slice(0, 10),
          requested_pickup_date: new Date().toISOString().slice(0, 10),
          updated_by: 'dashboard'
        })
        .select('id')
        .single();
      if (orderError) throw orderError;

      const orderId = orderRow?.id;
      if (!orderId) throw new Error('Order id not returned.');

      const { error: lineError } = await supabase.from('product_purchase_order_lines').insert({
        purchase_order_id: orderId,
        product_id: product.id,
        custom_item_name: null,
        quantity: Math.max(prompt.suggested_qty, 1),
        unit_price: product.default_unit_cost ?? prompt.last_price ?? 0,
        product_link: product.vendor_product_link,
        notes: 'Auto-created from prompt'
      });
      if (lineError) throw lineError;

      const { error: promptError } = await supabase
        .from('product_order_prompts')
        .update({ status: 'converted', converted_purchase_order_id: orderId })
        .eq('id', prompt.id);
      if (promptError) throw promptError;

      await loadDashboard();
      setActiveView('orders');
      setExpandedOrderId(orderId);
      setNotice('Prompt converted into a draft order.');
    });
  };

  const dismissPrompt = async (promptId: string) => {
    await withSaveState(async () => {
      const { error: updateError } = await supabase
        .from('product_order_prompts')
        .update({ status: 'dismissed' })
        .eq('id', promptId);
      if (updateError) throw updateError;
      await loadDashboard();
      setNotice('Prompt dismissed.');
    });
  };

  const uploadAttachment = useCallback(
    async (file: File) => {
      const bucket = 'product-files';
      const storagePath = `designs/${Date.now()}-${sanitizeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, file, {
        upsert: false,
        contentType: file.type || undefined
      });
      if (uploadError) throw uploadError;

      const { data: attachmentRow, error: attachmentError } = await supabase
        .from('product_attachments')
        .insert({
          bucket,
          storage_path: storagePath,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          uploaded_by: 'dashboard'
        })
        .select('id')
        .single();
      if (attachmentError) throw attachmentError;

      return attachmentRow?.id ?? null;
    },
    [supabase]
  );

  const createDesign = async () => {
    if (!newDesign.name.trim()) {
      setError('Design name is required.');
      return;
    }

    await withSaveState(async () => {
      const frontAttachmentId = newDesign.frontFile ? await uploadAttachment(newDesign.frontFile) : null;
      const backAttachmentId = newDesign.backFile ? await uploadAttachment(newDesign.backFile) : null;

      const { error: insertError } = await supabase.from('product_designs').insert({
        name: newDesign.name.trim(),
        category: newDesign.category.trim() || null,
        preferred_vendor_id: newDesign.preferred_vendor_id || null,
        priority: newDesign.priority,
        status: newDesign.status,
        estimated_cost: newDesign.estimated_cost ? Number(newDesign.estimated_cost) : null,
        notes: newDesign.description.trim() || null,
        front_attachment_id: frontAttachmentId,
        back_attachment_id: backAttachmentId,
        updated_by: 'dashboard'
      });
      if (insertError) throw insertError;

      setNewDesign({
        name: '',
        category: '',
        preferred_vendor_id: '',
        priority: 'normal',
        status: 'idea',
        estimated_cost: '',
        description: '',
        frontFile: null,
        backFile: null
      });
      await loadDashboard();
      setNotice('Design created.');
    });
  };

  const saveWishlistItem = async (item: WishlistRow) => {
    await withSaveState(async () => {
      const { error: updateError } = await supabase
        .from('product_wishlist_items')
        .update({
          item_name: item.item_name,
          category: item.category,
          vendor_id: item.vendor_id,
          estimated_cost: item.estimated_cost,
          priority: item.priority,
          status: item.status,
          notes: item.notes,
          updated_by: 'dashboard'
        })
        .eq('id', item.id);
      if (updateError) throw updateError;
      setNotice('Wishlist item saved.');
    });
  };

  const addWishlistItem = async () => {
    if (!newWishlistItem.item_name.trim()) {
      setError('Wishlist item name is required.');
      return;
    }

    await withSaveState(async () => {
      const { error: insertError } = await supabase.from('product_wishlist_items').insert({
        item_name: newWishlistItem.item_name.trim(),
        category: newWishlistItem.category.trim() || null,
        vendor_id: newWishlistItem.vendor_id || null,
        estimated_cost: newWishlistItem.estimated_cost ? Number(newWishlistItem.estimated_cost) : null,
        priority: newWishlistItem.priority,
        status: newWishlistItem.status,
        notes: newWishlistItem.notes.trim() || null,
        updated_by: 'dashboard'
      });
      if (insertError) throw insertError;
      setNewWishlistItem({
        item_name: '',
        category: '',
        vendor_id: '',
        estimated_cost: '',
        priority: 'normal',
        status: 'backlog',
        notes: ''
      });
      await loadDashboard();
      setNotice('Wishlist item added.');
    });
  };

  const convertWishlistToCatalogProduct = async (item: WishlistRow) => {
    await withSaveState(async () => {
      const { data: productRow, error: productError } = await supabase
        .from('product_products')
        .insert({
          name: item.item_name,
          category: item.category,
          preferred_vendor_id: item.vendor_id,
          default_unit_cost: item.estimated_cost,
          updated_by: 'dashboard'
        })
        .select('id')
        .single();
      if (productError) throw productError;

      const { error: wishlistError } = await supabase
        .from('product_wishlist_items')
        .update({
          status: 'converted',
          converted_product_id: productRow?.id ?? null,
          updated_by: 'dashboard'
        })
        .eq('id', item.id);
      if (wishlistError) throw wishlistError;

      await loadDashboard();
      setActiveView('products');
      setNotice('Wishlist item converted to product catalog.');
    });
  };

  const getAttachmentUrl = (attachmentId: string | null) => {
    if (!attachmentId) return null;
    const attachment = attachmentById.get(attachmentId);
    if (!attachment) return null;
    const { data } = supabase.storage.from(attachment.bucket).getPublicUrl(attachment.storage_path);
    return data.publicUrl;
  };

  if (loading) {
    return <main className="p-4 text-sm text-neutral-700">Loading product dashboard from database...</main>;
  }

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
              const isActive = activeView === item.id;
              return (
                <button
                  aria-selected={isActive}
                  className={`flex min-h-[44px] w-full items-center justify-between border-b border-neutral-300 px-4 py-3 text-left text-sm font-medium ${
                    isActive ? 'bg-brand-maroon text-white' : 'bg-white text-neutral-800 hover:bg-neutral-50'
                  }`}
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  role="tab"
                  type="button"
                >
                  <span>{item.label}</span>
                  {item.id === 'prompts' && promptCount > 0 ? <span className="text-xs tabular-nums">{promptCount}</span> : null}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="w-full flex-1">
          {(error || notice) && (
            <section className="border-b border-neutral-300 px-4 py-3 md:px-6">
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
              {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
            </section>
          )}

          {activeView === 'orders' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 bg-white px-4 py-4 md:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Orders</h2>
                    <p className="mt-1 text-sm text-neutral-600">Click an order number to open full details inline.</p>
                  </div>
                  <button
                    className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-4 text-sm font-medium text-white hover:bg-[#6a0000] disabled:opacity-60"
                    disabled={saving}
                    onClick={createOrder}
                    type="button"
                  >
                    + New Order
                  </button>
                </div>
              </header>

              <section className="border-b border-neutral-300 bg-white px-4 py-3 md:px-6" aria-label="Order filters">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <select
                    className="min-h-[38px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setOrderFilters((prev) => ({ ...prev, status: event.target.value }))}
                    value={orderFilters.status}
                  >
                    <option value="all">All Statuses</option>
                    {ORDER_STATUSES.map((status) => (
                      <option key={status} value={status}>{formatLabel(status)}</option>
                    ))}
                  </select>

                  <select
                    className="min-h-[38px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setOrderFilters((prev) => ({ ...prev, vendor: event.target.value }))}
                    value={orderFilters.vendor}
                  >
                    <option value="all">All Vendors</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                    ))}
                  </select>

                  <select
                    className="min-h-[38px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setOrderFilters((prev) => ({ ...prev, priority: event.target.value }))}
                    value={orderFilters.priority}
                  >
                    <option value="all">All Priorities</option>
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                  </select>

                  <input
                    className="min-h-[38px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setOrderFilters((prev) => ({ ...prev, search: event.target.value }))}
                    placeholder="Search orders"
                    type="search"
                    value={orderFilters.search}
                  />
                </div>
              </section>

              <div className="overflow-x-auto">
                <table className="min-w-full bg-white text-sm">
                  <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                    <tr>
                      <th className="border-b border-neutral-300 px-4 py-3">Order #</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Vendor</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Status</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Date Placed</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Requested Date</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Total</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => {
                      const isExpanded = expandedOrderId === order.id;
                      return (
                        <Fragment key={order.id}>
                          <tr className="border-b border-neutral-200 hover:bg-neutral-50" key={order.id}>
                            <td className="px-4 py-3 font-medium">
                              <button
                                className="underline-offset-2 hover:underline"
                                onClick={() => setExpandedOrderId((prev) => (prev === order.id ? null : order.id))}
                                type="button"
                              >
                                {order.order_number}
                              </button>
                            </td>
                            <td className="px-4 py-3">{vendorById.get(order.vendor_id)?.name ?? 'Unknown'}</td>
                            <td className="px-4 py-3">{formatLabel(order.status)}</td>
                            <td className="px-4 py-3">{order.date_placed ?? '-'}</td>
                            <td className="px-4 py-3">{order.requested_pickup_date ?? '-'}</td>
                            <td className="px-4 py-3">{currency.format(Number(order.total_amount || 0))}</td>
                            <td className="px-4 py-3">{formatLabel(order.priority)}</td>
                          </tr>

                          {isExpanded ? (
                            <tr className="bg-neutral-50" key={`${order.id}-detail`}>
                              <td className="px-4 py-4" colSpan={7}>
                                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                                  <label className="text-sm text-neutral-700">
                                    Vendor
                                    <select
                                      className="mt-1 min-h-[38px] w-full border border-neutral-300 bg-white px-2"
                                      onChange={(event) => {
                                        setOrders((prev) => prev.map((entry) => entry.id === order.id ? { ...entry, vendor_id: event.target.value } : entry));
                                      }}
                                      value={order.vendor_id}
                                    >
                                      {vendors.map((vendor) => (
                                        <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                                      ))}
                                    </select>
                                  </label>

                                  <label className="text-sm text-neutral-700">
                                    Status
                                    <select
                                      className="mt-1 min-h-[38px] w-full border border-neutral-300 bg-white px-2"
                                      onChange={(event) => {
                                        setOrders((prev) => prev.map((entry) => entry.id === order.id ? { ...entry, status: event.target.value as DbOrderStatus } : entry));
                                      }}
                                      value={order.status}
                                    >
                                      {ORDER_STATUSES.map((status) => (
                                        <option key={status} value={status}>{formatLabel(status)}</option>
                                      ))}
                                    </select>
                                  </label>

                                  <label className="text-sm text-neutral-700">
                                    Priority
                                    <select
                                      className="mt-1 min-h-[38px] w-full border border-neutral-300 bg-white px-2"
                                      onChange={(event) => {
                                        setOrders((prev) => prev.map((entry) => entry.id === order.id ? { ...entry, priority: event.target.value as DbPriority } : entry));
                                      }}
                                      value={order.priority}
                                    >
                                      <option value="normal">Normal</option>
                                      <option value="urgent">Urgent</option>
                                    </select>
                                  </label>

                                  <label className="text-sm text-neutral-700">
                                    Requester
                                    <input
                                      className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                                      onChange={(event) => {
                                        setOrders((prev) => prev.map((entry) => entry.id === order.id ? { ...entry, requester_name: event.target.value } : entry));
                                      }}
                                      type="text"
                                      value={order.requester_name}
                                    />
                                  </label>

                                  <label className="text-sm text-neutral-700">
                                    Activity Account
                                    <input
                                      className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                                      onChange={(event) => {
                                        setOrders((prev) => prev.map((entry) => entry.id === order.id ? { ...entry, activity_account: event.target.value } : entry));
                                      }}
                                      type="text"
                                      value={order.activity_account}
                                    />
                                  </label>

                                  <label className="text-sm text-neutral-700">
                                    Account Number
                                    <input
                                      className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                                      onChange={(event) => {
                                        setOrders((prev) => prev.map((entry) => entry.id === order.id ? { ...entry, account_number: event.target.value } : entry));
                                      }}
                                      type="text"
                                      value={order.account_number}
                                    />
                                  </label>

                                  <label className="text-sm text-neutral-700">
                                    Date Placed
                                    <input
                                      className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                                      onChange={(event) => {
                                        setOrders((prev) => prev.map((entry) => entry.id === order.id ? { ...entry, date_placed: event.target.value || null } : entry));
                                      }}
                                      type="date"
                                      value={order.date_placed ?? ''}
                                    />
                                  </label>

                                  <label className="text-sm text-neutral-700">
                                    Requested Pickup Date
                                    <input
                                      className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                                      onChange={(event) => {
                                        setOrders((prev) => prev.map((entry) => entry.id === order.id ? { ...entry, requested_pickup_date: event.target.value || null } : entry));
                                      }}
                                      type="date"
                                      value={order.requested_pickup_date ?? ''}
                                    />
                                  </label>

                                  <label className="text-sm text-neutral-700">
                                    Expected Arrival
                                    <input
                                      className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                                      onChange={(event) => {
                                        setOrders((prev) => prev.map((entry) => entry.id === order.id ? { ...entry, expected_arrival_date: event.target.value || null } : entry));
                                      }}
                                      type="date"
                                      value={order.expected_arrival_date ?? ''}
                                    />
                                  </label>

                                  <label className="text-sm text-neutral-700 lg:col-span-3">
                                    Reason
                                    <input
                                      className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                                      onChange={(event) => {
                                        setOrders((prev) => prev.map((entry) => entry.id === order.id ? { ...entry, reason: event.target.value } : entry));
                                      }}
                                      type="text"
                                      value={order.reason ?? ''}
                                    />
                                  </label>

                                  <label className="text-sm text-neutral-700 lg:col-span-3">
                                    Notes
                                    <textarea
                                      className="mt-1 min-h-[84px] w-full border border-neutral-300 px-2 py-2"
                                      onChange={(event) => {
                                        setOrders((prev) => prev.map((entry) => entry.id === order.id ? { ...entry, notes: event.target.value } : entry));
                                      }}
                                      value={order.notes ?? ''}
                                    />
                                  </label>
                                </div>

                                <div className="mt-4 overflow-x-auto">
                                  <table className="min-w-full bg-white text-sm">
                                    <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                                      <tr>
                                        <th className="border-b border-neutral-300 px-3 py-2">Product</th>
                                        <th className="border-b border-neutral-300 px-3 py-2">Custom Item</th>
                                        <th className="border-b border-neutral-300 px-3 py-2">Qty</th>
                                        <th className="border-b border-neutral-300 px-3 py-2">Unit Price</th>
                                        <th className="border-b border-neutral-300 px-3 py-2">Link</th>
                                        <th className="border-b border-neutral-300 px-3 py-2">Notes</th>
                                        <th className="border-b border-neutral-300 px-3 py-2">Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {order.lines.map((line) => (
                                        <tr className="border-b border-neutral-200" key={line.id}>
                                          <td className="px-3 py-2">
                                            <select
                                              className="min-h-[34px] w-full border border-neutral-300 bg-white px-2"
                                              onChange={(event) => {
                                                const nextProductId = event.target.value || null;
                                                setOrders((prev) =>
                                                  prev.map((entry) =>
                                                    entry.id !== order.id
                                                      ? entry
                                                      : {
                                                          ...entry,
                                                          lines: entry.lines.map((candidate) =>
                                                            candidate.id !== line.id
                                                              ? candidate
                                                              : {
                                                                  ...candidate,
                                                                  product_id: nextProductId,
                                                                  custom_item_name: nextProductId ? null : candidate.custom_item_name
                                                                }
                                                          )
                                                        }
                                                  )
                                                );
                                              }}
                                              value={line.product_id ?? ''}
                                            >
                                              <option value="">Custom Item</option>
                                              {products.map((product) => (
                                                <option key={product.id} value={product.id}>{product.name}</option>
                                              ))}
                                            </select>
                                          </td>
                                          <td className="px-3 py-2">
                                            <input
                                              className="min-h-[34px] w-full border border-neutral-300 px-2"
                                              onChange={(event) => {
                                                setOrders((prev) =>
                                                  prev.map((entry) =>
                                                    entry.id !== order.id
                                                      ? entry
                                                      : {
                                                          ...entry,
                                                          lines: entry.lines.map((candidate) =>
                                                            candidate.id === line.id ? { ...candidate, custom_item_name: event.target.value } : candidate
                                                          )
                                                        }
                                                  )
                                                );
                                              }}
                                              type="text"
                                              value={line.custom_item_name ?? ''}
                                            />
                                          </td>
                                          <td className="px-3 py-2">
                                            <input
                                              className="min-h-[34px] w-24 border border-neutral-300 px-2"
                                              min={1}
                                              onChange={(event) => {
                                                setOrders((prev) =>
                                                  prev.map((entry) =>
                                                    entry.id !== order.id
                                                      ? entry
                                                      : {
                                                          ...entry,
                                                          lines: entry.lines.map((candidate) =>
                                                            candidate.id === line.id ? { ...candidate, quantity: Math.max(Number(event.target.value), 1) } : candidate
                                                          )
                                                        }
                                                  )
                                                );
                                              }}
                                              type="number"
                                              value={line.quantity}
                                            />
                                          </td>
                                          <td className="px-3 py-2">
                                            <input
                                              className="min-h-[34px] w-28 border border-neutral-300 px-2"
                                              min={0}
                                              onChange={(event) => {
                                                setOrders((prev) =>
                                                  prev.map((entry) =>
                                                    entry.id !== order.id
                                                      ? entry
                                                      : {
                                                          ...entry,
                                                          lines: entry.lines.map((candidate) =>
                                                            candidate.id === line.id ? { ...candidate, unit_price: Math.max(Number(event.target.value), 0) } : candidate
                                                          )
                                                        }
                                                  )
                                                );
                                              }}
                                              step="0.01"
                                              type="number"
                                              value={line.unit_price}
                                            />
                                          </td>
                                          <td className="px-3 py-2">
                                            <input
                                              className="min-h-[34px] w-full border border-neutral-300 px-2"
                                              onChange={(event) => {
                                                setOrders((prev) =>
                                                  prev.map((entry) =>
                                                    entry.id !== order.id
                                                      ? entry
                                                      : {
                                                          ...entry,
                                                          lines: entry.lines.map((candidate) =>
                                                            candidate.id === line.id ? { ...candidate, product_link: event.target.value } : candidate
                                                          )
                                                        }
                                                  )
                                                );
                                              }}
                                              type="url"
                                              value={line.product_link ?? ''}
                                            />
                                          </td>
                                          <td className="px-3 py-2">
                                            <input
                                              className="min-h-[34px] w-full border border-neutral-300 px-2"
                                              onChange={(event) => {
                                                setOrders((prev) =>
                                                  prev.map((entry) =>
                                                    entry.id !== order.id
                                                      ? entry
                                                      : {
                                                          ...entry,
                                                          lines: entry.lines.map((candidate) =>
                                                            candidate.id === line.id ? { ...candidate, notes: event.target.value } : candidate
                                                          )
                                                        }
                                                  )
                                                );
                                              }}
                                              type="text"
                                              value={line.notes ?? ''}
                                            />
                                          </td>
                                          <td className="px-3 py-2">
                                            <div className="flex gap-2">
                                              <button
                                                className="min-h-[32px] border border-neutral-300 px-2 text-xs hover:bg-neutral-100"
                                                onClick={() => void saveOrderLine(line)}
                                                type="button"
                                              >
                                                Save
                                              </button>
                                              <button
                                                className="min-h-[32px] border border-red-700 px-2 text-xs text-red-700 hover:bg-red-50"
                                                onClick={() => void removeOrderLine(line.id)}
                                                type="button"
                                              >
                                                Remove
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>

                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <button
                                    className="min-h-[34px] border border-neutral-300 px-3 text-sm hover:bg-neutral-100"
                                    onClick={() => void addOrderLine(order.id)}
                                    type="button"
                                  >
                                    + Add Line
                                  </button>
                                  <button
                                    className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000]"
                                    onClick={() => void saveOrderHeader(order)}
                                    type="button"
                                  >
                                    Save Order
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeView === 'prompts' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Prompts</h2>
                <p className="mt-1 text-sm text-neutral-600">Submitting a new inventory count regenerates low-stock reorder prompts.</p>
              </header>

              <section className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h3 className="text-base font-semibold">Submit Inventory Count</h3>
                <p className="mt-1 text-sm text-neutral-600">Enter only items counted now, then submit. Prompt list refreshes from these counts.</p>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                  {products.map((product) => (
                    <label className="text-xs text-neutral-700" key={product.id}>
                      {product.name}
                      <input
                        className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                        min={0}
                        onChange={(event) => {
                          setInventoryQuantities((prev) => ({ ...prev, [product.id]: event.target.value }));
                        }}
                        placeholder="Quantity"
                        type="number"
                        value={inventoryQuantities[product.id] ?? ''}
                      />
                    </label>
                  ))}
                </div>
                <label className="mt-3 block text-sm text-neutral-700">
                  Upload Note
                  <textarea
                    className="mt-1 min-h-[74px] w-full border border-neutral-300 px-2 py-2"
                    onChange={(event) => setInventoryNote(event.target.value)}
                    value={inventoryNote}
                  />
                </label>
                <button
                  className="mt-3 min-h-[36px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000] disabled:opacity-60"
                  disabled={saving}
                  onClick={submitInventoryCounts}
                  type="button"
                >
                  Submit Inventory Count
                </button>
              </section>

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
                    {prompts.map((prompt) => {
                      const product = productById.get(prompt.product_id);
                      const vendorName = prompt.vendor_id ? vendorById.get(prompt.vendor_id)?.name : product?.preferred_vendor_id ? vendorById.get(product.preferred_vendor_id)?.name : 'Unassigned';
                      return (
                        <tr className="border-b border-neutral-200" key={prompt.id}>
                          <td className="px-4 py-3 font-medium">{product?.name ?? prompt.product_id}</td>
                          <td className="px-4 py-3">{prompt.current_stock}</td>
                          <td className="px-4 py-3">{prompt.on_order_qty}</td>
                          <td className="px-4 py-3">{prompt.suggested_qty}</td>
                          <td className="px-4 py-3">{vendorName ?? 'Unknown'}</td>
                          <td className="px-4 py-3">{prompt.last_price === null ? '-' : currency.format(prompt.last_price)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="min-h-[32px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white hover:bg-[#6a0000]"
                                onClick={() => void convertPromptToOrder(prompt)}
                                type="button"
                              >
                                Convert to Order
                              </button>
                              <button
                                className="min-h-[32px] border border-neutral-300 px-3 text-xs hover:bg-neutral-100"
                                onClick={() => void dismissPrompt(prompt.id)}
                                type="button"
                              >
                                Dismiss
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeView === 'products' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Products (Catalog)</h2>
                <p className="mt-1 text-sm text-neutral-600">Catalog-only details: what you sell, category/section, and sourcing vendor.</p>
              </header>

              <section className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h3 className="text-base font-semibold">Add Product</h3>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewProduct((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Product Name"
                    value={newProduct.name}
                  />
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewProduct((prev) => ({ ...prev, category: event.target.value }))}
                    placeholder="Category / Section"
                    value={newProduct.category}
                  />
                  <select
                    className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setNewProduct((prev) => ({ ...prev, preferred_vendor_id: event.target.value }))}
                    value={newProduct.preferred_vendor_id}
                  >
                    <option value="">Vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                    ))}
                  </select>
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewProduct((prev) => ({ ...prev, sku: event.target.value }))}
                    placeholder="SKU"
                    value={newProduct.sku}
                  />
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewProduct((prev) => ({ ...prev, default_unit_cost: event.target.value }))}
                    placeholder="Default Cost"
                    type="number"
                    value={newProduct.default_unit_cost}
                  />
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewProduct((prev) => ({ ...prev, retail_price: event.target.value }))}
                    placeholder="Retail Price"
                    type="number"
                    value={newProduct.retail_price}
                  />
                </div>
                <button
                  className="mt-3 min-h-[36px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000]"
                  onClick={() => void addProduct()}
                  type="button"
                >
                  Add Product
                </button>
              </section>

              <section className="space-y-4 px-4 py-4 md:px-6">
                {productsByCategory.map(([category, rows]) => (
                  <article className="border border-neutral-300" key={category}>
                    <header className="border-b border-neutral-300 bg-neutral-100 px-4 py-2 text-sm font-semibold">{category}</header>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-white text-left text-xs uppercase tracking-wide text-neutral-600">
                          <tr>
                            <th className="border-b border-neutral-200 px-3 py-2">Name</th>
                            <th className="border-b border-neutral-200 px-3 py-2">Vendor</th>
                            <th className="border-b border-neutral-200 px-3 py-2">SKU</th>
                            <th className="border-b border-neutral-200 px-3 py-2">Vendor Link</th>
                            <th className="border-b border-neutral-200 px-3 py-2">Default Cost</th>
                            <th className="border-b border-neutral-200 px-3 py-2">Retail Price</th>
                            <th className="border-b border-neutral-200 px-3 py-2">Save</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((product) => (
                            <tr className="border-b border-neutral-100" key={product.id}>
                              <td className="px-3 py-2">
                                <input
                                  className="min-h-[34px] w-full border border-neutral-300 px-2"
                                  onChange={(event) => {
                                    setProducts((prev) => prev.map((entry) => entry.id === product.id ? { ...entry, name: event.target.value } : entry));
                                  }}
                                  value={product.name}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  className="min-h-[34px] w-full border border-neutral-300 bg-white px-2"
                                  onChange={(event) => {
                                    setProducts((prev) => prev.map((entry) => entry.id === product.id ? { ...entry, preferred_vendor_id: event.target.value || null } : entry));
                                  }}
                                  value={product.preferred_vendor_id ?? ''}
                                >
                                  <option value="">None</option>
                                  {vendors.map((vendor) => (
                                    <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  className="min-h-[34px] w-full border border-neutral-300 px-2"
                                  onChange={(event) => {
                                    setProducts((prev) => prev.map((entry) => entry.id === product.id ? { ...entry, sku: event.target.value } : entry));
                                  }}
                                  value={product.sku ?? ''}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  className="min-h-[34px] w-full border border-neutral-300 px-2"
                                  onChange={(event) => {
                                    setProducts((prev) => prev.map((entry) => entry.id === product.id ? { ...entry, vendor_product_link: event.target.value } : entry));
                                  }}
                                  value={product.vendor_product_link ?? ''}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  className="min-h-[34px] w-28 border border-neutral-300 px-2"
                                  min={0}
                                  onChange={(event) => {
                                    const next = event.target.value;
                                    setProducts((prev) => prev.map((entry) => entry.id === product.id ? { ...entry, default_unit_cost: next ? Number(next) : null } : entry));
                                  }}
                                  step="0.01"
                                  type="number"
                                  value={product.default_unit_cost ?? ''}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  className="min-h-[34px] w-28 border border-neutral-300 px-2"
                                  min={0}
                                  onChange={(event) => {
                                    const next = event.target.value;
                                    setProducts((prev) => prev.map((entry) => entry.id === product.id ? { ...entry, retail_price: next ? Number(next) : null } : entry));
                                  }}
                                  step="0.01"
                                  type="number"
                                  value={product.retail_price ?? ''}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  className="min-h-[32px] border border-neutral-300 px-3 text-xs hover:bg-neutral-100"
                                  onClick={() => void saveProduct(product)}
                                  type="button"
                                >
                                  Save
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                ))}
              </section>
            </section>
          )}

          {activeView === 'vendors' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Vendors</h2>
                <p className="mt-1 text-sm text-neutral-600">Lead time removed. Notes are saved directly to database.</p>
              </header>

              <section className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h3 className="text-base font-semibold">Add Vendor</h3>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewVendor((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Vendor Name"
                    value={newVendor.name}
                  />
                  <select
                    className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setNewVendor((prev) => ({ ...prev, ordering_method: event.target.value as DbOrderingMethod }))}
                    value={newVendor.ordering_method}
                  >
                    {ORDERING_METHODS.map((method) => (
                      <option key={method} value={method}>{formatLabel(method)}</option>
                    ))}
                  </select>
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewVendor((prev) => ({ ...prev, default_link: event.target.value }))}
                    placeholder="Default Link"
                    value={newVendor.default_link}
                  />
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewVendor((prev) => ({ ...prev, notes: event.target.value }))}
                    placeholder="Notes"
                    value={newVendor.notes}
                  />
                </div>
                <button
                  className="mt-3 min-h-[36px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000]"
                  onClick={() => void addVendor()}
                  type="button"
                >
                  Add Vendor
                </button>
              </section>

              <div className="overflow-x-auto px-4 py-4 md:px-6">
                <table className="min-w-full text-sm">
                  <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                    <tr>
                      <th className="border-b border-neutral-300 px-4 py-3">Vendor</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Ordering Method</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Default Link</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Notes</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Save</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.map((vendor) => (
                      <tr className="border-b border-neutral-200" key={vendor.id}>
                        <td className="px-4 py-3">
                          <input
                            className="min-h-[34px] w-full border border-neutral-300 px-2"
                            onChange={(event) => {
                              setVendors((prev) => prev.map((entry) => entry.id === vendor.id ? { ...entry, name: event.target.value } : entry));
                            }}
                            value={vendor.name}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <select
                            className="min-h-[34px] w-full border border-neutral-300 bg-white px-2"
                            onChange={(event) => {
                              setVendors((prev) => prev.map((entry) => entry.id === vendor.id ? { ...entry, ordering_method: event.target.value as DbOrderingMethod } : entry));
                            }}
                            value={vendor.ordering_method}
                          >
                            {ORDERING_METHODS.map((method) => (
                              <option key={method} value={method}>{formatLabel(method)}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            className="min-h-[34px] w-full border border-neutral-300 px-2"
                            onChange={(event) => {
                              setVendors((prev) => prev.map((entry) => entry.id === vendor.id ? { ...entry, default_link: event.target.value } : entry));
                            }}
                            value={vendor.default_link ?? ''}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            className="min-h-[34px] w-full border border-neutral-300 px-2"
                            onChange={(event) => {
                              setVendors((prev) => prev.map((entry) => entry.id === vendor.id ? { ...entry, notes: event.target.value } : entry));
                            }}
                            value={vendor.notes ?? ''}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            className="min-h-[32px] border border-neutral-300 px-3 text-xs hover:bg-neutral-100"
                            onClick={() => void saveVendor(vendor)}
                            type="button"
                          >
                            Save
                          </button>
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
                <p className="mt-1 text-sm text-neutral-600">Create designs with front/back image upload, priority, and description.</p>
              </header>

              <section className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h3 className="text-base font-semibold">Create Design</h3>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewDesign((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Design Name"
                    value={newDesign.name}
                  />
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewDesign((prev) => ({ ...prev, category: event.target.value }))}
                    placeholder="Category"
                    value={newDesign.category}
                  />
                  <select
                    className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setNewDesign((prev) => ({ ...prev, preferred_vendor_id: event.target.value }))}
                    value={newDesign.preferred_vendor_id}
                  >
                    <option value="">Preferred Vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                    ))}
                  </select>

                  <select
                    className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setNewDesign((prev) => ({ ...prev, priority: event.target.value as DbDesignPriority }))}
                    value={newDesign.priority}
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>{formatLabel(priority)}</option>
                    ))}
                  </select>
                  <select
                    className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setNewDesign((prev) => ({ ...prev, status: event.target.value as DbDesignStatus }))}
                    value={newDesign.status}
                  >
                    {DESIGN_STATUSES.map((status) => (
                      <option key={status} value={status}>{formatLabel(status)}</option>
                    ))}
                  </select>
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewDesign((prev) => ({ ...prev, estimated_cost: event.target.value }))}
                    placeholder="Estimated Cost"
                    type="number"
                    value={newDesign.estimated_cost}
                  />

                  <label className="text-sm text-neutral-700">
                    Front Image
                    <input
                      className="mt-1 block w-full border border-neutral-300 p-2 text-sm"
                      onChange={(event) => setNewDesign((prev) => ({ ...prev, frontFile: event.target.files?.[0] ?? null }))}
                      type="file"
                    />
                  </label>
                  <label className="text-sm text-neutral-700">
                    Back Image
                    <input
                      className="mt-1 block w-full border border-neutral-300 p-2 text-sm"
                      onChange={(event) => setNewDesign((prev) => ({ ...prev, backFile: event.target.files?.[0] ?? null }))}
                      type="file"
                    />
                  </label>
                  <label className="text-sm text-neutral-700 md:col-span-1">
                    Description
                    <textarea
                      className="mt-1 min-h-[80px] w-full border border-neutral-300 px-2 py-2"
                      onChange={(event) => setNewDesign((prev) => ({ ...prev, description: event.target.value }))}
                      value={newDesign.description}
                    />
                  </label>
                </div>
                <button
                  className="mt-3 min-h-[36px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000]"
                  onClick={() => void createDesign()}
                  type="button"
                >
                  Create Design
                </button>
              </section>

              <section className="space-y-3 bg-neutral-100 px-4 py-4 md:px-6">
                {designs.map((design) => {
                  const frontUrl = getAttachmentUrl(design.front_attachment_id);
                  const backUrl = getAttachmentUrl(design.back_attachment_id);
                  return (
                    <article className="border border-neutral-300 bg-white" key={design.id}>
                      <div className="grid grid-cols-1 gap-0 border-b border-neutral-300 md:grid-cols-6">
                        <div className="border-b border-neutral-300 bg-neutral-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 md:border-b-0 md:border-r">
                          Front
                        </div>
                        <div className="min-h-[140px] border-b border-neutral-300 bg-neutral-100 md:border-b-0 md:border-r">
                          {frontUrl ? (
                            <Image
                              alt={`${design.name} front`}
                              className="h-full w-full object-cover"
                              height={320}
                              src={frontUrl}
                              unoptimized
                              width={320}
                            />
                          ) : null}
                        </div>
                        <div className="border-b border-neutral-300 bg-neutral-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 md:border-b-0 md:border-r">
                          Back
                        </div>
                        <div className="min-h-[140px] border-b border-neutral-300 bg-neutral-100 md:border-b-0 md:border-r">
                          {backUrl ? (
                            <Image
                              alt={`${design.name} back`}
                              className="h-full w-full object-cover"
                              height={320}
                              src={backUrl}
                              unoptimized
                              width={320}
                            />
                          ) : null}
                        </div>
                        <div className="px-3 py-3 md:border-r md:border-neutral-300">
                          <p className="text-xs text-neutral-500">Name / Category</p>
                          <p className="text-sm font-medium">{design.name}</p>
                          <p className="text-xs text-neutral-600">{design.category || 'Uncategorized'}</p>
                        </div>
                        <div className="px-3 py-3">
                          <p className="text-xs text-neutral-500">Priority / Status</p>
                          <p className="text-sm font-medium">{formatLabel(design.priority)} / {formatLabel(design.status)}</p>
                          <p className="mt-1 text-xs text-neutral-600">{design.notes || 'No description'}</p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            </section>
          )}

          {activeView === 'wishlist' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Wishlist</h2>
                <p className="mt-1 text-sm text-neutral-600">Edit wishlist rows and convert directly into product catalog entries.</p>
              </header>

              <section className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h3 className="text-base font-semibold">Add Wishlist Item</h3>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewWishlistItem((prev) => ({ ...prev, item_name: event.target.value }))}
                    placeholder="Item Name"
                    value={newWishlistItem.item_name}
                  />
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewWishlistItem((prev) => ({ ...prev, category: event.target.value }))}
                    placeholder="Category"
                    value={newWishlistItem.category}
                  />
                  <select
                    className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setNewWishlistItem((prev) => ({ ...prev, vendor_id: event.target.value }))}
                    value={newWishlistItem.vendor_id}
                  >
                    <option value="">Vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                    ))}
                  </select>
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setNewWishlistItem((prev) => ({ ...prev, estimated_cost: event.target.value }))}
                    placeholder="Estimated Cost"
                    type="number"
                    value={newWishlistItem.estimated_cost}
                  />
                  <select
                    className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setNewWishlistItem((prev) => ({ ...prev, priority: event.target.value as DbDesignPriority }))}
                    value={newWishlistItem.priority}
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>{formatLabel(priority)}</option>
                    ))}
                  </select>
                  <select
                    className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setNewWishlistItem((prev) => ({ ...prev, status: event.target.value as DbWishlistStatus }))}
                    value={newWishlistItem.status}
                  >
                    {WISHLIST_STATUSES.map((status) => (
                      <option key={status} value={status}>{formatLabel(status)}</option>
                    ))}
                  </select>
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm md:col-span-2"
                    onChange={(event) => setNewWishlistItem((prev) => ({ ...prev, notes: event.target.value }))}
                    placeholder="Notes"
                    value={newWishlistItem.notes}
                  />
                </div>
                <button
                  className="mt-3 min-h-[36px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000]"
                  onClick={() => void addWishlistItem()}
                  type="button"
                >
                  Add Wishlist Item
                </button>
              </section>

              <div className="overflow-x-auto px-4 py-4 md:px-6">
                <table className="min-w-full text-sm">
                  <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                    <tr>
                      <th className="border-b border-neutral-300 px-4 py-3">Item</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Category</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Vendor</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Estimated Cost</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Priority</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Status</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Notes</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wishlist.map((item) => (
                      <tr className="border-b border-neutral-200" key={item.id}>
                        <td className="px-4 py-3">
                          <input
                            className="min-h-[34px] w-full border border-neutral-300 px-2"
                            onChange={(event) => {
                              setWishlist((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, item_name: event.target.value } : entry));
                            }}
                            value={item.item_name}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            className="min-h-[34px] w-full border border-neutral-300 px-2"
                            onChange={(event) => {
                              setWishlist((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, category: event.target.value } : entry));
                            }}
                            value={item.category ?? ''}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <select
                            className="min-h-[34px] w-full border border-neutral-300 bg-white px-2"
                            onChange={(event) => {
                              setWishlist((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, vendor_id: event.target.value || null } : entry));
                            }}
                            value={item.vendor_id ?? ''}
                          >
                            <option value="">None</option>
                            {vendors.map((vendor) => (
                              <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            className="min-h-[34px] w-28 border border-neutral-300 px-2"
                            min={0}
                            onChange={(event) => {
                              const next = event.target.value;
                              setWishlist((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, estimated_cost: next ? Number(next) : null } : entry));
                            }}
                            step="0.01"
                            type="number"
                            value={item.estimated_cost ?? ''}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <select
                            className="min-h-[34px] w-full border border-neutral-300 bg-white px-2"
                            onChange={(event) => {
                              setWishlist((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, priority: event.target.value as DbDesignPriority } : entry));
                            }}
                            value={item.priority}
                          >
                            {PRIORITIES.map((priority) => (
                              <option key={priority} value={priority}>{formatLabel(priority)}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            className="min-h-[34px] w-full border border-neutral-300 bg-white px-2"
                            onChange={(event) => {
                              setWishlist((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, status: event.target.value as DbWishlistStatus } : entry));
                            }}
                            value={item.status}
                          >
                            {WISHLIST_STATUSES.map((status) => (
                              <option key={status} value={status}>{formatLabel(status)}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            className="min-h-[34px] w-full border border-neutral-300 px-2"
                            onChange={(event) => {
                              setWishlist((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, notes: event.target.value } : entry));
                            }}
                            value={item.notes ?? ''}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="min-h-[32px] border border-neutral-300 px-3 text-xs hover:bg-neutral-100"
                              onClick={() => void saveWishlistItem(item)}
                              type="button"
                            >
                              Edit/Save
                            </button>
                            <button
                              className="min-h-[32px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white hover:bg-[#6a0000]"
                              onClick={() => void convertWishlistToCatalogProduct(item)}
                              type="button"
                            >
                              Convert to Catalog
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

          {activeView === 'settings' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold">Settings</h2>
                <p className="mt-1 text-sm text-neutral-600">Defaults for new orders and prompt cutoff logic.</p>
              </header>
              <section className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-2 md:px-6">
                <label className="text-sm text-neutral-700">
                  Requester default
                  <input
                    className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                    onBlur={(event) => void saveSetting('order.requester_default', event.target.value)}
                    onChange={(event) => setSettingsMap((prev) => ({ ...prev, 'order.requester_default': event.target.value }))}
                    type="text"
                    value={settingsMap['order.requester_default'] ?? ''}
                  />
                </label>
                <label className="text-sm text-neutral-700">
                  Activity account default
                  <input
                    className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                    onBlur={(event) => void saveSetting('order.activity_account_default', event.target.value)}
                    onChange={(event) => setSettingsMap((prev) => ({ ...prev, 'order.activity_account_default': event.target.value }))}
                    type="text"
                    value={settingsMap['order.activity_account_default'] ?? ''}
                  />
                </label>
                <label className="text-sm text-neutral-700">
                  Account number default
                  <input
                    className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                    onBlur={(event) => void saveSetting('order.account_number_default', event.target.value)}
                    onChange={(event) => setSettingsMap((prev) => ({ ...prev, 'order.account_number_default': event.target.value }))}
                    type="text"
                    value={settingsMap['order.account_number_default'] ?? ''}
                  />
                </label>
                <label className="text-sm text-neutral-700">
                  Prompt low-stock cutoff
                  <input
                    className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                    min={0}
                    onBlur={(event) => void saveSetting('prompt.low_stock_cutoff', String(Math.max(Number(event.target.value) || 0, 0)))}
                    onChange={(event) => setSettingsMap((prev) => ({ ...prev, 'prompt.low_stock_cutoff': event.target.value }))}
                    type="number"
                    value={settingsMap['prompt.low_stock_cutoff'] ?? '2'}
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
