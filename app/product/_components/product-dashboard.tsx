'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';

import { DepartmentShell } from '@/app/_components/department-shell';
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
  category_id: string | null;
  subcategory_id: string | null;
  preferred_vendor_id: string | null;
  vendor_product_link: string | null;
  default_unit_cost: number | null;
  units_per_purchase: number;
  default_order_quantity: number;
  notes: string | null;
  sku: string | null;
  barcode_upc: string | null;
  is_active: boolean;
}

interface ProductCategoryRow {
  id: string;
  name: string;
  parent_category_id: string | null;
  sort_order: number;
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
  units_per_purchase: number;
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

interface LineAttachmentRow {
  id: string;
  purchase_order_line_id: string;
  description: string | null;
  attachment_id: string;
  attachment: AttachmentRow | null;
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

interface PromptConvertDraft {
  prompt_id: string;
  product_name: string;
  vendor_id: string;
  quantity: number;
  unit_price: number;
  reason: string;
  notes: string;
  requested_pickup_date: string;
  priority: DbPriority;
}

interface CreateOrderLineDraft {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  units_per_purchase: number;
  product_link: string;
  notes: string;
}

type CategoryDropPosition = 'before' | 'inside' | 'after';

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

function createDraftId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getStatusBadgeClass(status: DbOrderStatus) {
  switch (status) {
    case 'draft':
      return 'bg-neutral-200 text-neutral-800';
    case 'submitted':
      return 'bg-blue-100 text-blue-800';
    case 'approved':
      return 'bg-emerald-100 text-emerald-800';
    case 'ordered':
      return 'bg-indigo-100 text-indigo-800';
    case 'partially_received':
      return 'bg-amber-100 text-amber-900';
    case 'received':
      return 'bg-green-100 text-green-900';
    case 'archived':
      return 'bg-slate-200 text-slate-800';
    case 'cancelled':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-neutral-200 text-neutral-800';
  }
}

function getPriorityBadgeClass(priority: DbPriority) {
  return priority === 'urgent' ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800';
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
  const [productCategories, setProductCategories] = useState<ProductCategoryRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [lineAttachments, setLineAttachments] = useState<LineAttachmentRow[]>([]);
  const [wishlist, setWishlist] = useState<WishlistRow[]>([]);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [showCreateOrderModal, setShowCreateOrderModal] = useState(false);
  const [showEditOrderModal, setShowEditOrderModal] = useState(false);
  const [cancelOrderTarget, setCancelOrderTarget] = useState<OrderRow | null>(null);
  const [editingOrderDraft, setEditingOrderDraft] = useState<OrderRow | null>(null);
  const [lineModalMode, setLineModalMode] = useState<'add' | 'edit' | null>(null);
  const [lineModalOrderId, setLineModalOrderId] = useState<string | null>(null);
  const [lineModalLineId, setLineModalLineId] = useState<string | null>(null);
  const [lineModalDraft, setLineModalDraft] = useState<CreateOrderLineDraft | null>(null);
  const [lineModalErrors, setLineModalErrors] = useState<Record<string, string>>({});
  const [lineProductDropdownOpen, setLineProductDropdownOpen] = useState(false);
  const [lineProductQuery, setLineProductQuery] = useState('');
  const [lineFilesModalLineId, setLineFilesModalLineId] = useState<string | null>(null);
  const lineProductDropdownRef = useRef<HTMLDivElement | null>(null);

  const [orderFilters, setOrderFilters] = useState({
    status: 'all',
    vendor: 'all',
    priority: 'all',
    date_from: '',
    date_to: '',
    search: ''
  });
  const [productFilters, setProductFilters] = useState({
    category: 'all',
    subcategory: 'all',
    search: ''
  });


  const [newProduct, setNewProduct] = useState({
    name: '',
    category_id: '',
    subcategory_id: '',
    preferred_vendor_id: '',
    sku: '',
    vendor_product_link: '',
    default_unit_cost: '',
    units_per_purchase: '1',
    default_order_quantity: '1',
    notes: ''
  });
  const [lineAttachmentDrafts, setLineAttachmentDrafts] = useState<
    Record<string, { file: File | null; description: string }>
  >({});
  const [lineAttachmentUploadingIds, setLineAttachmentUploadingIds] = useState<string[]>([]);
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
  const [promptConvertDraft, setPromptConvertDraft] = useState<PromptConvertDraft | null>(null);
  const [newOrderDraft, setNewOrderDraft] = useState({
    vendor_id: '',
    priority: 'normal' as DbPriority,
    asap: false,
    date_placed: '',
    requested_pickup_date: '',
    expected_arrival_date: '',
    reason: '',
    notes: ''
  });
  const [newProductCategory, setNewProductCategory] = useState({
    name: ''
  });
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [categoryDropTarget, setCategoryDropTarget] = useState<{ id: string; position: CategoryDropPosition } | null>(null);
  const [editingCategoryDraft, setEditingCategoryDraft] = useState<{
    id: string;
    name: string;
    parent_category_id: string | null;
  } | null>(null);

  const vendorById = useMemo(() => {
    const map = new Map<string, VendorRow>();
    vendors.forEach((vendor) => map.set(vendor.id, vendor));
    return map;
  }, [vendors]);

  const categoryById = useMemo(() => {
    const map = new Map<string, ProductCategoryRow>();
    productCategories.forEach((category) => map.set(category.id, category));
    return map;
  }, [productCategories]);

  const rootCategories = useMemo(
    () =>
      productCategories
        .filter((category) => !category.parent_category_id)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [productCategories]
  );

  const subcategoriesByParent = useMemo(() => {
    const map = new Map<string, ProductCategoryRow[]>();
    for (const category of productCategories) {
      if (!category.parent_category_id) continue;
      const bucket = map.get(category.parent_category_id) ?? [];
      bucket.push(category);
      map.set(category.parent_category_id, bucket);
    }
    map.forEach((bucket) => bucket.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
    return map;
  }, [productCategories]);

  const productById = useMemo(() => {
    const map = new Map<string, ProductRow>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const lineById = useMemo(() => {
    const map = new Map<string, OrderLineRow>();
    for (const order of orders) {
      for (const line of order.lines) {
        map.set(line.id, line);
      }
    }
    return map;
  }, [orders]);

  const attachmentById = useMemo(() => {
    const map = new Map<string, AttachmentRow>();
    attachments.forEach((attachment) => map.set(attachment.id, attachment));
    return map;
  }, [attachments]);

  const lineAttachmentsByLine = useMemo(() => {
    const map = new Map<string, LineAttachmentRow[]>();
    for (const row of lineAttachments) {
      const bucket = map.get(row.purchase_order_line_id) ?? [];
      bucket.push(row);
      map.set(row.purchase_order_line_id, bucket);
    }
    return map;
  }, [lineAttachments]);

  const promptCount = useMemo(() => prompts.filter((prompt) => prompt.status === 'open').length, [prompts]);

  const filteredLineProductOptions = useMemo(() => {
    const query = lineProductQuery.trim().toLowerCase();
    return products
      .filter((product) => {
        if (!query) return true;
        return [product.name, product.sku ?? '', product.barcode_upc ?? '', product.notes ?? '']
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 60);
  }, [products, lineProductQuery]);

  const lineModalOrder = useMemo(() => {
    if (!lineModalOrderId) return null;
    return orders.find((order) => order.id === lineModalOrderId) ?? null;
  }, [lineModalOrderId, orders]);

  const vendorScopedLineProductOptions = useMemo(() => {
    if (!lineModalOrder?.vendor_id) return [];
    return filteredLineProductOptions.filter((product) => product.preferred_vendor_id === lineModalOrder.vendor_id);
  }, [filteredLineProductOptions, lineModalOrder]);

  useEffect(() => {
    if (!lineProductDropdownOpen) return;
    const onWindowPointerDown = (event: MouseEvent) => {
      if (!lineProductDropdownRef.current) return;
      if (!lineProductDropdownRef.current.contains(event.target as Node)) {
        setLineProductDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', onWindowPointerDown);
    return () => window.removeEventListener('mousedown', onWindowPointerDown);
  }, [lineProductDropdownOpen]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [
      settingsResult,
      vendorsResult,
      categoriesResult,
      productsResult,
      ordersResult,
      linesResult,
      promptsResult,
      designsResult,
      attachmentsResult,
      lineAttachmentsResult,
      wishlistResult
    ] = await Promise.all([
      supabase.from('product_settings').select('key,value'),
      supabase
        .from('product_vendors')
        .select('id,name,ordering_method,default_link,notes,is_active')
        .order('name', { ascending: true }),
      supabase
        .from('product_categories')
        .select('id,name,parent_category_id,sort_order,is_active')
        .eq('is_active', true)
        .order('parent_category_id', { ascending: true, nullsFirst: true })
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('product_products')
        .select('id,name,category,category_id,subcategory_id,preferred_vendor_id,vendor_product_link,default_unit_cost,units_per_purchase,default_order_quantity,notes,sku,barcode_upc,is_active')
        .eq('is_active', true)
        .order('category', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('product_purchase_orders')
        .select('id,order_number,requester_name,activity_account,account_number,vendor_id,status,reason,priority,date_placed,requested_pickup_date,expected_arrival_date,asap,notes,total_amount')
        .order('created_at', { ascending: false }),
      supabase
        .from('product_purchase_order_lines')
        .select('id,purchase_order_id,product_id,custom_item_name,quantity,unit_price,units_per_purchase,product_link,notes')
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
        .from('product_purchase_order_line_attachments')
        .select('id,purchase_order_line_id,description,attachment_id,attachment:product_attachments(id,bucket,storage_path,file_name,mime_type,size_bytes)')
        .order('created_at', { ascending: false }),
      supabase
        .from('product_wishlist_items')
        .select('id,item_name,category,vendor_id,estimated_cost,priority,status,notes,converted_purchase_order_id,converted_design_id,converted_product_id')
        .order('created_at', { ascending: false })
    ]);

    const firstError = [
      settingsResult.error,
      vendorsResult.error,
      categoriesResult.error,
      productsResult.error,
      ordersResult.error,
      linesResult.error,
      promptsResult.error,
      designsResult.error,
      attachmentsResult.error,
      lineAttachmentsResult.error,
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
        unit_price: Number(line.unit_price),
        units_per_purchase: Math.max(Number(line.units_per_purchase ?? 1), 1)
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
    setProductCategories(((categoriesResult.data ?? []) as ProductCategoryRow[]).filter((category) => category.is_active));
    setProducts(
      ((productsResult.data ?? []) as ProductRow[]).map((product) => ({
        ...product,
        default_unit_cost: product.default_unit_cost === null ? null : Number(product.default_unit_cost),
        units_per_purchase: Math.max(Number(product.units_per_purchase ?? 1), 1),
        default_order_quantity: Math.max(Number(product.default_order_quantity ?? 1), 1)
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
    setLineAttachments(
      ((lineAttachmentsResult.data ?? []) as Array<{
        id: string;
        purchase_order_line_id: string;
        description: string | null;
        attachment_id: string;
        attachment: AttachmentRow | AttachmentRow[] | null;
      }>).map((row) => ({
        id: row.id,
        purchase_order_line_id: row.purchase_order_line_id,
        description: row.description,
        attachment_id: row.attachment_id,
        attachment: Array.isArray(row.attachment) ? (row.attachment[0] ?? null) : (row.attachment ?? null)
      }))
    );
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
      if (orderFilters.date_from && (order.date_placed ?? '') < orderFilters.date_from) return false;
      if (orderFilters.date_to && (order.date_placed ?? '') > orderFilters.date_to) return false;
      const query = orderFilters.search.trim().toLowerCase();
      if (!query) return true;
      const vendorName = vendorById.get(order.vendor_id)?.name ?? '';
      return [order.order_number, vendorName, order.reason ?? '', order.notes ?? ''].join(' ').toLowerCase().includes(query);
    });
  }, [orders, orderFilters, vendorById]);

  const productsByCategory = useMemo(() => {
    return [...products]
      .filter((product) => {
        if (productFilters.category !== 'all' && product.category_id !== productFilters.category) return false;
        if (productFilters.subcategory !== 'all' && product.subcategory_id !== productFilters.subcategory) return false;
        const query = productFilters.search.trim().toLowerCase();
        if (!query) return true;
        const categoryName = product.category_id ? categoryById.get(product.category_id)?.name ?? '' : '';
        const subcategoryName = product.subcategory_id ? categoryById.get(product.subcategory_id)?.name ?? '' : '';
        return [product.name, product.sku ?? '', product.notes ?? '', categoryName, subcategoryName]
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, productFilters, categoryById]);

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
          category_id: product.category_id,
          subcategory_id: product.subcategory_id,
          preferred_vendor_id: product.preferred_vendor_id,
          vendor_product_link: product.vendor_product_link,
          default_unit_cost: product.default_unit_cost,
          units_per_purchase: Math.max(Number(product.units_per_purchase) || 1, 1),
          default_order_quantity: Math.max(Number(product.default_order_quantity) || 1, 1),
          notes: product.notes,
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
        category_id: newProduct.category_id || null,
        subcategory_id: newProduct.subcategory_id || null,
        preferred_vendor_id: newProduct.preferred_vendor_id || null,
        sku: newProduct.sku.trim() || null,
        vendor_product_link: newProduct.vendor_product_link.trim() || null,
        default_unit_cost: newProduct.default_unit_cost ? Number(newProduct.default_unit_cost) : null,
        units_per_purchase: Math.max(Number(newProduct.units_per_purchase) || 1, 1),
        default_order_quantity: Math.max(Number(newProduct.default_order_quantity) || 1, 1),
        notes: newProduct.notes.trim() || null,
        updated_by: 'dashboard'
      });
      if (insertError) throw insertError;
      setNewProduct({
        name: '',
        category_id: '',
        subcategory_id: '',
        preferred_vendor_id: '',
        sku: '',
        vendor_product_link: '',
        default_unit_cost: '',
        units_per_purchase: '1',
        default_order_quantity: '1',
        notes: ''
      });
      await loadDashboard();
      setNotice('Product added.');
    });
  };

  const addProductCategory = async () => {
    if (!newProductCategory.name.trim()) {
      setError('Category name is required.');
      return;
    }

    await withSaveState(async () => {
      const { error: insertError } = await supabase.from('product_categories').insert({
        name: newProductCategory.name.trim(),
        parent_category_id: null,
        updated_by: 'dashboard'
      });
      if (insertError) throw insertError;
      setNewProductCategory({ name: '' });
      await loadDashboard();
      setNotice('Category saved.');
    });
  };

  const saveProductCategoryEdit = async () => {
    if (!editingCategoryDraft) return;
    if (!editingCategoryDraft.name.trim()) {
      setError('Category name is required.');
      return;
    }

    await withSaveState(async () => {
      const { error: updateError } = await supabase
        .from('product_categories')
        .update({
          name: editingCategoryDraft.name.trim(),
          parent_category_id: editingCategoryDraft.parent_category_id,
          updated_by: 'dashboard'
        })
        .eq('id', editingCategoryDraft.id);
      if (updateError) throw updateError;
      setEditingCategoryDraft(null);
      await loadDashboard();
      setNotice('Category updated.');
    });
  };

  const saveCategoryLayout = async (
    updates: Array<{ id: string; parent_category_id: string | null; sort_order: number }>
  ) => {
    await withSaveState(async () => {
      if (updates.length === 0) return;
      const updateCalls = updates.map((entry) =>
        supabase
          .from('product_categories')
          .update({
            parent_category_id: entry.parent_category_id,
            sort_order: entry.sort_order,
            updated_by: 'dashboard'
          })
          .eq('id', entry.id)
      );
      const results = await Promise.all(updateCalls);
      const firstError = results.find((result) => result.error)?.error;
      if (firstError) throw firstError;
      await loadDashboard();
      setNotice('Category layout updated.');
    });
  };

  const resetCategoryDragState = () => {
    setDraggedCategoryId(null);
    setCategoryDropTarget(null);
  };

  const isDescendantCategory = (candidateId: string, potentialAncestorId: string): boolean => {
    let current = productCategories.find((category) => category.id === candidateId);
    while (current?.parent_category_id) {
      if (current.parent_category_id === potentialAncestorId) return true;
      current = productCategories.find((category) => category.id === current?.parent_category_id);
    }
    return false;
  };

  const moveCategoryToPosition = async (
    draggingId: string,
    destinationParentId: string | null,
    destinationIndex: number
  ) => {
    const moving = productCategories.find((category) => category.id === draggingId);
    if (!moving) return;
    if (destinationParentId === moving.id) return;
    if (destinationParentId && isDescendantCategory(destinationParentId, draggingId)) return;

    const sourceParentId = moving.parent_category_id;
    const sourceSiblings = productCategories
      .filter((category) => category.parent_category_id === sourceParentId && category.id !== moving.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const targetSiblings = productCategories
      .filter((category) => category.parent_category_id === destinationParentId && category.id !== moving.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    const boundedIndex = Math.max(0, Math.min(destinationIndex, targetSiblings.length));
    targetSiblings.splice(boundedIndex, 0, moving);

    const updatesMap = new Map<string, { id: string; parent_category_id: string | null; sort_order: number }>();

    if (sourceParentId === destinationParentId) {
      targetSiblings.forEach((category, index) => {
        updatesMap.set(category.id, { id: category.id, parent_category_id: destinationParentId, sort_order: index });
      });
    } else {
      sourceSiblings.forEach((category, index) => {
        updatesMap.set(category.id, { id: category.id, parent_category_id: sourceParentId, sort_order: index });
      });
      targetSiblings.forEach((category, index) => {
        updatesMap.set(category.id, { id: category.id, parent_category_id: destinationParentId, sort_order: index });
      });
    }

    const updates = Array.from(updatesMap.values());
    if (updates.length === 0) return;
    await saveCategoryLayout(updates);
  };

  const applyCategoryDrop = async (targetId: string, position: CategoryDropPosition) => {
    if (!draggedCategoryId) return;
    if (draggedCategoryId === targetId && position === 'inside') {
      resetCategoryDragState();
      return;
    }

    const target = productCategories.find((category) => category.id === targetId);
    if (!target) {
      resetCategoryDragState();
      return;
    }

    if (position === 'inside') {
      const children = productCategories
        .filter((category) => category.parent_category_id === target.id && category.id !== draggedCategoryId)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      await moveCategoryToPosition(draggedCategoryId, target.id, children.length);
      resetCategoryDragState();
      return;
    }

    const siblingParentId = target.parent_category_id;
    const siblings = productCategories
      .filter((category) => category.parent_category_id === siblingParentId && category.id !== draggedCategoryId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const targetIndex = siblings.findIndex((category) => category.id === target.id);
    if (targetIndex < 0) {
      resetCategoryDragState();
      return;
    }
    const destinationIndex = position === 'before' ? targetIndex : targetIndex + 1;
    await moveCategoryToPosition(draggedCategoryId, siblingParentId, destinationIndex);
    resetCategoryDragState();
  };

  const openCreateOrderModal = () => {
    const today = new Date().toISOString().slice(0, 10);
    setNewOrderDraft({
      vendor_id: vendors[0]?.id ?? '',
      priority: 'normal',
      asap: false,
      date_placed: today,
      requested_pickup_date: today,
      expected_arrival_date: '',
      reason: '',
      notes: ''
    });
    setShowCreateOrderModal(true);
  };

  const createOrder = async () => {
    await withSaveState(async () => {
      if (!newOrderDraft.vendor_id) throw new Error('Select a vendor before creating the order.');
      if (!newOrderDraft.date_placed) throw new Error('Date placed is required.');
      if (!newOrderDraft.asap && !newOrderDraft.requested_pickup_date) {
        throw new Error('Requested pickup date is required unless ASAP is enabled.');
      }

      const requester = settingsMap['order.requester_default'] ?? '';
      const activity = settingsMap['order.activity_account_default'] ?? '';
      const account = settingsMap['order.account_number_default'] ?? '';
      if (!requester || !activity || !account) {
        throw new Error('Missing required defaults in Settings (requester/activity/account).');
      }

      const { data, error: insertError } = await supabase
        .from('product_purchase_orders')
        .insert({
          order_number: generateOrderNumber(),
          requester_name: requester,
          activity_account: activity,
          account_number: account,
          vendor_id: newOrderDraft.vendor_id,
          status: 'draft',
          priority: newOrderDraft.priority,
          asap: newOrderDraft.asap,
          date_placed: newOrderDraft.date_placed,
          requested_pickup_date: newOrderDraft.asap ? null : newOrderDraft.requested_pickup_date,
          expected_arrival_date: newOrderDraft.expected_arrival_date || null,
          reason: newOrderDraft.reason.trim() || null,
          notes: newOrderDraft.notes.trim() || null,
          updated_by: 'dashboard'
        })
        .select('id')
        .single();
      if (insertError) throw insertError;
      await loadDashboard();
      setShowCreateOrderModal(false);
      if (data?.id) {
        setSelectedOrderId(data.id);
      }
      setNotice('Order created.');
    });
  };

  const cancelDraftOrder = async (order: OrderRow) => {
    if (order.status !== 'draft') {
      setError('Only draft orders can be cancelled from this screen.');
      return;
    }
    await withSaveState(async () => {
      const { error: deleteError } = await supabase.from('product_purchase_orders').delete().eq('id', order.id);
      if (deleteError) throw deleteError;
      if (selectedOrderId === order.id) {
        setSelectedOrderId(null);
      }
      await loadDashboard();
      setNotice(`Draft order ${order.order_number} cancelled.`);
    });
  };

  const cancelOrderQuick = async (order: OrderRow) => {
    await withSaveState(async () => {
      if (order.status === 'cancelled') {
        setCancelOrderTarget(null);
        return;
      }
      const { error: updateError } = await supabase
        .from('product_purchase_orders')
        .update({
          status: 'cancelled',
          updated_by: 'dashboard'
        })
        .eq('id', order.id);
      if (updateError) throw updateError;
      setCancelOrderTarget(null);
      await loadDashboard();
      setNotice(`Order ${order.order_number} cancelled.`);
    });
  };

  const saveOrderHeader = async (order: OrderRow) => {
    await withSaveState(async () => {
      const { error: updateError } = await supabase
        .from('product_purchase_orders')
        .update({
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

  const openEditOrderModal = (order: OrderRow) => {
    setEditingOrderDraft({ ...order });
    setShowEditOrderModal(true);
  };

  const saveEditOrderModal = async () => {
    if (!editingOrderDraft) return;
    await saveOrderHeader(editingOrderDraft);
    setShowEditOrderModal(false);
    setEditingOrderDraft(null);
  };

  const validateLineDraft = (draft: CreateOrderLineDraft): Record<string, string> => {
    const nextErrors: Record<string, string> = {};
    if (!draft.product_id) nextErrors.product_id = 'Product is required.';
    if (!Number.isFinite(draft.quantity) || draft.quantity < 1) nextErrors.quantity = 'Quantity must be at least 1.';
    return nextErrors;
  };

  const openAddLineItemModal = (orderId: string) => {
    setLineModalMode('add');
    setLineModalOrderId(orderId);
    setLineModalLineId(null);
    setLineModalErrors({});
    setLineProductQuery('');
    setLineProductDropdownOpen(false);
    setLineModalDraft({
      id: createDraftId(),
      product_id: '',
      quantity: 1,
      unit_price: 0,
      units_per_purchase: 1,
      product_link: '',
      notes: ''
    });
  };

  const openEditLineItemModal = (orderId: string, line: OrderLineRow) => {
    setLineModalMode('edit');
    setLineModalOrderId(orderId);
    setLineModalLineId(line.id);
    setLineModalErrors({});
    setLineProductQuery(line.product_id ? productById.get(line.product_id)?.name ?? '' : '');
    setLineProductDropdownOpen(false);
    setLineModalDraft({
      id: line.id,
      product_id: line.product_id ?? '',
      quantity: Math.max(Number(line.quantity) || 1, 1),
      unit_price: Math.max(Number(line.unit_price) || 0, 0),
      units_per_purchase: Math.max(Number(line.units_per_purchase) || 1, 1),
      product_link: line.product_link ?? '',
      notes: line.notes ?? ''
    });
  };

  const closeLineModal = () => {
    setLineModalMode(null);
    setLineModalOrderId(null);
    setLineModalLineId(null);
    setLineModalDraft(null);
    setLineModalErrors({});
    setLineProductQuery('');
    setLineProductDropdownOpen(false);
  };

  const applyLineProductSelection = (product: ProductRow) => {
    setLineModalDraft((prev) =>
      prev
        ? {
            ...prev,
            product_id: product.id,
            unit_price: Number(product.default_unit_cost ?? prev.unit_price),
            units_per_purchase: product.units_per_purchase ?? prev.units_per_purchase,
            product_link: product.vendor_product_link ?? prev.product_link
          }
        : prev
    );
    setLineProductQuery(product.name);
    setLineProductDropdownOpen(false);
  };

  const saveLineModal = async () => {
    if (!lineModalMode || !lineModalDraft || !lineModalOrderId) return;
    const errors = validateLineDraft(lineModalDraft);
    setLineModalErrors(errors);
    if (Object.keys(errors).length > 0) return;

    await withSaveState(async () => {
      const order = orders.find((entry) => entry.id === lineModalOrderId);
      if (!order) throw new Error('Order not found.');
      const selectedProduct = productById.get(lineModalDraft.product_id);
      if (!selectedProduct) throw new Error('Selected product not found in catalog.');
      if (selectedProduct.preferred_vendor_id !== order.vendor_id) {
        throw new Error('You can only add products configured for this order vendor.');
      }
      const catalogLink = (selectedProduct.vendor_product_link ?? '').trim();
      if (!catalogLink || !/^https?:\/\//i.test(catalogLink)) {
        throw new Error('This catalog item is missing a valid vendor link. Update it in Products first.');
      }
      if (selectedProduct.default_unit_cost === null || !Number.isFinite(Number(selectedProduct.default_unit_cost))) {
        throw new Error('This catalog item is missing unit cost. Update it in Products first.');
      }

      const payload = {
        product_id: lineModalDraft.product_id,
        custom_item_name: null,
        quantity: Math.max(Math.trunc(lineModalDraft.quantity), 1),
        unit_price: Math.max(Number(selectedProduct.default_unit_cost), 0),
        units_per_purchase: Math.max(Math.trunc(selectedProduct.units_per_purchase || 1), 1),
        product_link: catalogLink
      };

      if (lineModalMode === 'add') {
        const { error: insertError } = await supabase.from('product_purchase_order_lines').insert({
          purchase_order_id: lineModalOrderId,
          ...payload,
          notes: null
        });
        if (insertError) throw insertError;
      } else {
        const { error: updateError } = await supabase
          .from('product_purchase_order_lines')
          .update(payload)
          .eq('id', lineModalLineId as string);
        if (updateError) throw updateError;
      }
      await loadDashboard();
      setSelectedOrderId(lineModalOrderId);
      closeLineModal();
      setNotice(lineModalMode === 'add' ? 'Line item added.' : 'Line item updated.');
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


  const convertPromptToOrder = async (
    prompt: PromptRow,
    overrides?: {
      vendor_id?: string;
      quantity?: number;
      unit_price?: number;
      reason?: string;
      notes?: string;
      requested_pickup_date?: string;
      priority?: DbPriority;
    }
  ) => {
    await withSaveState(async () => {
      const product = productById.get(prompt.product_id);
      if (!product) throw new Error('Prompt product not found.');
      const vendorId = overrides?.vendor_id || prompt.vendor_id || product.preferred_vendor_id || vendors[0]?.id;
      if (!vendorId) throw new Error('No vendor available for conversion.');

      const requester = settingsMap['order.requester_default'] ?? '';
      const activity = settingsMap['order.activity_account_default'] ?? '';
      const account = settingsMap['order.account_number_default'] ?? '';
      const quantity = Math.max(Math.trunc(overrides?.quantity ?? prompt.suggested_qty), 1);
      const unitPrice = Number(overrides?.unit_price ?? product.default_unit_cost ?? prompt.last_price ?? 0);
      const reason = (overrides?.reason ?? `Converted from prompt: ${product.name}`).trim();
      const notes = (overrides?.notes ?? 'Converted from reorder prompt').trim();
      const requestedPickupDate = overrides?.requested_pickup_date || new Date().toISOString().slice(0, 10);
      const priority = overrides?.priority ?? 'normal';
      const defaultLink = product.vendor_product_link?.trim() || '';
      if (!defaultLink || !/^https?:\/\//i.test(defaultLink)) {
        throw new Error(`Product "${product.name}" needs a valid default link before converting prompt to order.`);
      }

      const { data: orderRow, error: orderError } = await supabase
        .from('product_purchase_orders')
        .insert({
          order_number: generateOrderNumber(),
          requester_name: requester,
          activity_account: activity,
          account_number: account,
          vendor_id: vendorId,
          status: 'draft',
          priority,
          reason: reason || null,
          notes: notes || null,
          date_placed: new Date().toISOString().slice(0, 10),
          requested_pickup_date: requestedPickupDate,
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
        quantity,
        unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
        units_per_purchase: Math.max(Number(product.units_per_purchase) || 1, 1),
        product_link: defaultLink,
        notes: notes || 'Auto-created from prompt'
      });
      if (lineError) throw lineError;

      const { error: promptError } = await supabase
        .from('product_order_prompts')
        .update({ status: 'converted', converted_purchase_order_id: orderId })
        .eq('id', prompt.id);
      if (promptError) throw promptError;

      await loadDashboard();
      setActiveView('orders');
      setSelectedOrderId(orderId);
      setPromptConvertDraft(null);
      setNotice('Prompt converted into a draft order.');
    });
  };

  const openPromptConvertModal = (prompt: PromptRow) => {
    const product = productById.get(prompt.product_id);
    const vendorId = prompt.vendor_id || product?.preferred_vendor_id || vendors[0]?.id || '';
    setPromptConvertDraft({
      prompt_id: prompt.id,
      product_name: product?.name ?? prompt.product_id,
      vendor_id: vendorId,
      quantity: Math.max(Math.trunc(prompt.suggested_qty), 1),
      unit_price: Number(product?.default_unit_cost ?? prompt.last_price ?? 0),
      reason: `Converted from prompt: ${product?.name ?? prompt.product_id}`,
      notes: 'Converted from reorder prompt',
      requested_pickup_date: new Date().toISOString().slice(0, 10),
      priority: 'normal'
    });
  };

  const confirmPromptConvert = async () => {
    if (!promptConvertDraft) return;
    const prompt = prompts.find((entry) => entry.id === promptConvertDraft.prompt_id);
    if (!prompt) {
      setError('Prompt no longer exists.');
      setPromptConvertDraft(null);
      return;
    }

    await convertPromptToOrder(prompt, {
      vendor_id: promptConvertDraft.vendor_id || undefined,
      quantity: promptConvertDraft.quantity,
      unit_price: promptConvertDraft.unit_price,
      reason: promptConvertDraft.reason,
      notes: promptConvertDraft.notes,
      requested_pickup_date: promptConvertDraft.requested_pickup_date,
      priority: promptConvertDraft.priority
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

  const savePrompt = async (prompt: PromptRow) => {
    await withSaveState(async () => {
      const { error: updateError } = await supabase
        .from('product_order_prompts')
        .update({
          suggested_qty: Math.max(0, Math.trunc(prompt.suggested_qty)),
          vendor_id: prompt.vendor_id,
          last_price: prompt.last_price
        })
        .eq('id', prompt.id);
      if (updateError) throw updateError;
      setNotice('Prompt updated.');
      await loadDashboard();
    });
  };

  const uploadAttachment = useCallback(
    async (file: File, folder: string = 'designs') => {
      const bucket = 'product-files';
      const storagePath = `${folder}/${Date.now()}-${sanitizeFileName(file.name)}`;
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

  const uploadLineAttachment = async (lineId: string) => {
    const draft = lineAttachmentDrafts[lineId];
    if (!draft?.file) {
      setError('Select an image/file first.');
      return;
    }
    if (lineAttachmentUploadingIds.includes(lineId)) {
      return;
    }

    setLineFilesModalLineId(null);
    setNotice('Uploading line item file in background...');
    setLineAttachmentUploadingIds((prev) => [...prev, lineId]);
    setLineAttachmentDrafts((prev) => ({
      ...prev,
      [lineId]: { file: null, description: '' }
    }));

    try {
      const attachmentId = await uploadAttachment(draft.file as File, `orders/lines/${lineId}`);
      if (!attachmentId) throw new Error('Failed to create attachment metadata.');

      const { error: relationError } = await supabase.from('product_purchase_order_line_attachments').insert({
        purchase_order_line_id: lineId,
        attachment_id: attachmentId,
        description: draft.description.trim() || null,
        created_by: 'dashboard'
      });
      if (relationError) throw relationError;

      await loadDashboard();
      setNotice('Line item attachment uploaded.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload line item attachment.';
      setError(message);
    } finally {
      setLineAttachmentUploadingIds((prev) => prev.filter((id) => id !== lineId));
    }
  };

  const removeLineAttachment = async (entry: LineAttachmentRow) => {
    await withSaveState(async () => {
      if (entry.attachment) {
        const { error: storageError } = await supabase.storage
          .from(entry.attachment.bucket)
          .remove([entry.attachment.storage_path]);
        if (storageError) throw storageError;
      }

      const { error: deleteAttachmentError } = await supabase
        .from('product_attachments')
        .delete()
        .eq('id', entry.attachment_id);
      if (deleteAttachmentError) throw deleteAttachmentError;

      await loadDashboard();
      setNotice('Line item file removed.');
    });
  };

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
    <DepartmentShell
      activeNavId={activeView}
      navAriaLabel="Product navigation"
      navItems={NAV_ITEMS.map((item) => ({
        ...item,
        badge: item.id === 'prompts' && promptCount > 0 ? promptCount : undefined
      }))}
      onNavSelect={(id) => setActiveView(id as DashboardView)}
      subtitle="School Store Operations Portal"
      title="Product Dashboard"
    >
      <section className="w-full flex-1">
          {(error || notice) && (
            <section className="border-b border-neutral-300 px-4 py-3 md:px-6">
              {error ? <p className="text-sm text-red-700">{error}</p> : null}
              {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
            </section>
          )}

          {activeView === 'orders' && (
            <section className="w-full bg-white">
              <header className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Orders</h2>
                  <button
                    className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-4 text-sm font-medium text-white hover:bg-[#6a0000] disabled:opacity-60"
                    disabled={saving}
                    onClick={openCreateOrderModal}
                    type="button"
                  >
                    + New Order
                  </button>
                </div>
              </header>

              <section className="border-b border-neutral-300 px-4 py-3 md:px-6">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                  <label className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                    Status
                    <select
                      className="mt-1 min-h-[38px] w-full border border-neutral-300 bg-white px-2 text-sm"
                      onChange={(event) => setOrderFilters((prev) => ({ ...prev, status: event.target.value }))}
                      value={orderFilters.status}
                    >
                      <option value="all">All Statuses</option>
                      {ORDER_STATUSES.map((status) => (
                        <option key={status} value={status}>{formatLabel(status)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                    Vendor
                    <select
                      className="mt-1 min-h-[38px] w-full border border-neutral-300 bg-white px-2 text-sm"
                      onChange={(event) => setOrderFilters((prev) => ({ ...prev, vendor: event.target.value }))}
                      value={orderFilters.vendor}
                    >
                      <option value="all">All Vendors</option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                    Priority
                    <select
                      className="mt-1 min-h-[38px] w-full border border-neutral-300 bg-white px-2 text-sm"
                      onChange={(event) => setOrderFilters((prev) => ({ ...prev, priority: event.target.value }))}
                      value={orderFilters.priority}
                    >
                      <option value="all">All Priorities</option>
                      <option value="normal">Normal</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                    Date From
                    <input
                      className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2 text-sm"
                      onChange={(event) => setOrderFilters((prev) => ({ ...prev, date_from: event.target.value }))}
                      type="date"
                      value={orderFilters.date_from}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                    Date To
                    <input
                      className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2 text-sm"
                      onChange={(event) => setOrderFilters((prev) => ({ ...prev, date_to: event.target.value }))}
                      type="date"
                      value={orderFilters.date_to}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                    Search
                    <input
                      className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2 text-sm"
                      onChange={(event) => setOrderFilters((prev) => ({ ...prev, search: event.target.value }))}
                      type="search"
                      value={orderFilters.search}
                    />
                  </label>
                </div>
              </section>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                    <tr>
                      <th className="border-b border-neutral-300 px-4 py-3">Order #</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Vendor</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Status</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Date Placed</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Requested Date</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Total</th>
                      <th className="border-b border-neutral-300 px-4 py-3">Priority</th>
                      <th className="border-b border-neutral-300 px-4 py-3 text-right">Quick Cancel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => {
                      const isSelected = selectedOrderId === order.id;
                      return (
                        <Fragment key={order.id}>
                          <tr
                            className={`cursor-pointer border-b border-neutral-200 ${isSelected ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                            onClick={() => setSelectedOrderId((prev) => (prev === order.id ? null : order.id))}
                          >
                            <td className="px-4 py-3 font-medium">{order.order_number}</td>
                            <td className="px-4 py-3">{vendorById.get(order.vendor_id)?.name ?? 'Unknown'}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${getStatusBadgeClass(order.status)}`}>
                                {formatLabel(order.status)}
                              </span>
                            </td>
                            <td className="px-4 py-3">{order.date_placed ?? '-'}</td>
                            <td className="px-4 py-3">{order.requested_pickup_date ?? (order.asap ? 'ASAP' : '-')}</td>
                            <td className="px-4 py-3">{currency.format(Number(order.total_amount || 0))}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${getPriorityBadgeClass(order.priority)}`}>
                                {formatLabel(order.priority)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                aria-label={`Cancel order ${order.order_number}`}
                                className="inline-flex min-h-[30px] min-w-[30px] items-center justify-center rounded border border-red-700 text-red-700 hover:bg-red-50 disabled:opacity-50"
                                disabled={order.status === 'cancelled'}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setCancelOrderTarget(order);
                                }}
                                type="button"
                              >
                                <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                                  <path d="M4 7h16" strokeLinecap="round" />
                                  <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" strokeLinecap="round" />
                                  <path d="M7 7l1 12a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9L17 7" strokeLinecap="round" />
                                  <path d="M10 11v5M14 11v5" strokeLinecap="round" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                          {isSelected ? (
                            <tr className="border-b border-neutral-300 bg-neutral-50">
                              <td className="px-4 py-4" colSpan={8}>
                                <div className="space-y-5 rounded border border-neutral-300 bg-white p-4 shadow-sm">
                                  <section>
                                    <div className="mb-2 flex items-center justify-between">
                                      <h3 className="text-base font-semibold">Order Details</h3>
                                      <div className="flex items-center gap-2">
                                        <button
                                          className="min-h-[34px] border border-neutral-300 px-3 text-xs hover:bg-neutral-100"
                                          onClick={() => openEditOrderModal(order)}
                                          type="button"
                                        >
                                          Edit Order
                                        </button>
                                        {order.status === 'draft' ? (
                                          <button
                                            className="min-h-[34px] border border-red-700 px-3 text-xs text-red-700 hover:bg-red-50"
                                            onClick={() => void cancelDraftOrder(order)}
                                            type="button"
                                          >
                                            Cancel Draft
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                      <p><span className="font-medium">Vendor:</span> {vendorById.get(order.vendor_id)?.name ?? 'Unknown'}</p>
                                      <p>
                                        <span className="font-medium">Status:</span>{' '}
                                        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${getStatusBadgeClass(order.status)}`}>
                                          {formatLabel(order.status)}
                                        </span>
                                      </p>
                                      <p>
                                        <span className="font-medium">Priority:</span>{' '}
                                        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${getPriorityBadgeClass(order.priority)}`}>
                                          {formatLabel(order.priority)}
                                        </span>
                                      </p>
                                      <p><span className="font-medium">Date placed:</span> {order.date_placed ?? '-'}</p>
                                      <p><span className="font-medium">Requested:</span> {order.requested_pickup_date ?? (order.asap ? 'ASAP' : '-')}</p>
                                      <p><span className="font-medium">Expected:</span> {order.expected_arrival_date ?? '-'}</p>
                                      <p className="col-span-2"><span className="font-medium">Reason:</span> {order.reason ?? '-'}</p>
                                      <p className="col-span-2"><span className="font-medium">Notes:</span> {order.notes ?? '-'}</p>
                                    </div>
                                  </section>

                                  <section>
                                    <div className="mb-2 flex items-center justify-between">
                                      <h4 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">Line Items</h4>
                                      <button
                                        className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white hover:bg-[#6a0000]"
                                        onClick={() => openAddLineItemModal(order.id)}
                                        type="button"
                                      >
                                        Add Existing Catalog Item
                                      </button>
                                    </div>
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-xs">
                                        <thead className="bg-neutral-100 text-left uppercase tracking-wide text-neutral-600">
                                          <tr>
                                            <th className="border-b border-neutral-300 px-2 py-2">Product</th>
                                            <th className="border-b border-neutral-300 px-2 py-2">How Many Ordered</th>
                                            <th className="border-b border-neutral-300 px-2 py-2">Cost Of 1 Ordered Item</th>
                                            <th className="border-b border-neutral-300 px-2 py-2">Items Per Ordered Item</th>
                                            <th className="border-b border-neutral-300 px-2 py-2">Link</th>
                                            <th className="border-b border-neutral-300 px-2 py-2">Notes</th>
                                            <th className="border-b border-neutral-300 px-2 py-2">Line Total</th>
                                            <th className="border-b border-neutral-300 px-2 py-2">Actions</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {order.lines.map((line) => (
                                            <tr className="border-b border-neutral-200" key={line.id}>
                                              <td className="px-2 py-2">{line.product_id ? productById.get(line.product_id)?.name ?? 'Unknown' : '-'}</td>
                                              <td className="px-2 py-2">{line.quantity}</td>
                                              <td className="px-2 py-2">{currency.format(line.unit_price)}</td>
                                              <td className="px-2 py-2">{line.units_per_purchase}</td>
                                              <td className="px-2 py-2">
                                                {line.product_link ? (
                                                  <a className="underline hover:no-underline" href={line.product_link} rel="noreferrer" target="_blank">Open</a>
                                                ) : '-'}
                                              </td>
                                              <td className="px-2 py-2">{line.notes ?? '-'}</td>
                                              <td className="px-2 py-2">{currency.format(Math.max(Number(line.quantity) || 0, 0) * Math.max(Number(line.unit_price) || 0, 0))}</td>
                                              <td className="px-2 py-2">
                                                <div className="flex gap-1">
                                                  <button
                                                    className="min-h-[30px] border border-neutral-300 px-2 text-[11px] hover:bg-neutral-100"
                                                    onClick={() => {
                                                      setLineFilesModalLineId(line.id);
                                                      setLineAttachmentDrafts((prev) => ({
                                                        ...prev,
                                                        [line.id]: prev[line.id] ?? { file: null, description: '' }
                                                      }));
                                                    }}
                                                    type="button"
                                                  >
                                                    Files ({lineAttachmentsByLine.get(line.id)?.length ?? 0})
                                                  </button>
                                                  <button
                                                    className="min-h-[30px] border border-neutral-300 px-2 text-[11px] hover:bg-neutral-100"
                                                    onClick={() => openEditLineItemModal(order.id, line)}
                                                    type="button"
                                                  >
                                                    Edit
                                                  </button>
                                                  <button
                                                    className="min-h-[30px] border border-red-700 px-2 text-[11px] text-red-700 hover:bg-red-50"
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
                                  </section>
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
                <p className="mt-1 text-sm text-neutral-600">
                  Low-stock prompts are generated automatically from Inventory Dashboard upload checks.
                </p>
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
                    {prompts.map((prompt) => {
                      const product = productById.get(prompt.product_id);
                      const currentVendorId = prompt.vendor_id ?? product?.preferred_vendor_id ?? '';
                      return (
                        <tr className="border-b border-neutral-200" key={prompt.id}>
                          <td className="px-4 py-3 font-medium">{product?.name ?? prompt.product_id}</td>
                          <td className="px-4 py-3">{prompt.current_stock}</td>
                          <td className="px-4 py-3">{prompt.on_order_qty}</td>
                          <td className="px-4 py-3">
                            <input
                              className="min-h-[34px] w-24 border border-neutral-300 px-2"
                              min={0}
                              onChange={(event) => {
                                const nextValue = Math.max(Number(event.target.value) || 0, 0);
                                setPrompts((prev) =>
                                  prev.map((entry) =>
                                    entry.id === prompt.id ? { ...entry, suggested_qty: nextValue } : entry
                                  )
                                );
                              }}
                              step={1}
                              type="number"
                              value={prompt.suggested_qty}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <select
                              className="min-h-[34px] w-full border border-neutral-300 bg-white px-2"
                              onChange={(event) => {
                                setPrompts((prev) =>
                                  prev.map((entry) =>
                                    entry.id === prompt.id
                                      ? { ...entry, vendor_id: event.target.value || null }
                                      : entry
                                  )
                                );
                              }}
                              value={currentVendorId}
                            >
                              <option value="">Unassigned</option>
                              {vendors.map((vendor) => (
                                <option key={vendor.id} value={vendor.id}>
                                  {vendor.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <input
                              className="min-h-[34px] w-28 border border-neutral-300 px-2"
                              min={0}
                              onChange={(event) => {
                                const next = event.target.value;
                                setPrompts((prev) =>
                                  prev.map((entry) =>
                                    entry.id === prompt.id
                                      ? { ...entry, last_price: next ? Number(next) : null }
                                      : entry
                                  )
                                );
                              }}
                              step="0.01"
                              type="number"
                              value={prompt.last_price ?? ''}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="min-h-[32px] border border-neutral-300 px-3 text-xs hover:bg-neutral-100"
                                onClick={() => void savePrompt(prompt)}
                                type="button"
                              >
                                Save
                              </button>
                              <button
                                className="min-h-[32px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white hover:bg-[#6a0000]"
                                onClick={() => openPromptConvertModal(prompt)}
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
                <p className="mt-1 text-sm text-neutral-600">
                  Catalog details: item cost, units per ordered item, description, and sourcing vendor.
                </p>
              </header>

              <section className="border-b border-neutral-300 px-4 py-4 md:px-6">
                <h3 className="text-base font-semibold">Add Product</h3>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
                  <label className="text-sm text-neutral-700">
                    Product Name
                    <input
                      className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2 text-sm"
                      onChange={(event) => setNewProduct((prev) => ({ ...prev, name: event.target.value }))}
                      value={newProduct.name}
                    />
                  </label>
                  <label className="text-sm text-neutral-700">
                    Category
                    <select
                      className="mt-1 min-h-[36px] w-full border border-neutral-300 bg-white px-2 text-sm"
                      onChange={(event) =>
                        setNewProduct((prev) => ({
                          ...prev,
                          category_id: event.target.value,
                          subcategory_id: ''
                        }))
                      }
                      value={newProduct.category_id}
                    >
                      <option value="">Select category</option>
                      {rootCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-neutral-700">
                    Subcategory
                    <select
                      className="mt-1 min-h-[36px] w-full border border-neutral-300 bg-white px-2 text-sm"
                      onChange={(event) => setNewProduct((prev) => ({ ...prev, subcategory_id: event.target.value }))}
                      value={newProduct.subcategory_id}
                    >
                      <option value="">Optional subcategory</option>
                      {(newProduct.category_id ? subcategoriesByParent.get(newProduct.category_id) ?? [] : []).map((subcategory) => (
                        <option key={subcategory.id} value={subcategory.id}>
                          {subcategory.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-neutral-700">
                    Vendor
                    <select
                      className="mt-1 min-h-[36px] w-full border border-neutral-300 bg-white px-2 text-sm"
                      onChange={(event) => setNewProduct((prev) => ({ ...prev, preferred_vendor_id: event.target.value }))}
                      value={newProduct.preferred_vendor_id}
                    >
                      <option value="">Select vendor</option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-neutral-700">
                    SKU
                    <input
                      className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2 text-sm"
                      onChange={(event) => setNewProduct((prev) => ({ ...prev, sku: event.target.value }))}
                      value={newProduct.sku}
                    />
                  </label>
                  <label className="text-sm text-neutral-700">
                    Cost Of 1 Ordered Item
                    <input
                      className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2 text-sm"
                      onChange={(event) => setNewProduct((prev) => ({ ...prev, default_unit_cost: event.target.value }))}
                      type="number"
                      value={newProduct.default_unit_cost}
                    />
                  </label>
                  <label className="text-sm text-neutral-700">
                    Items Per Ordered Item
                    <input
                      className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2 text-sm"
                      onChange={(event) => setNewProduct((prev) => ({ ...prev, units_per_purchase: event.target.value }))}
                      type="number"
                      min={1}
                      step={1}
                      value={newProduct.units_per_purchase}
                    />
                  </label>
                  <label className="text-sm text-neutral-700">
                    Default Qty To Order
                    <input
                      className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2 text-sm"
                      min={1}
                      onChange={(event) => setNewProduct((prev) => ({ ...prev, default_order_quantity: event.target.value }))}
                      step={1}
                      type="number"
                      value={newProduct.default_order_quantity}
                    />
                  </label>
                  <label className="text-sm text-neutral-700 md:col-span-2">
                    Vendor Link
                    <input
                      className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2 text-sm"
                      onChange={(event) => setNewProduct((prev) => ({ ...prev, vendor_product_link: event.target.value }))}
                      value={newProduct.vendor_product_link}
                    />
                  </label>
                  <label className="text-sm text-neutral-700 md:col-span-4">
                    Notes
                    <textarea
                      className="mt-1 min-h-[72px] w-full border border-neutral-300 px-2 py-2 text-sm"
                      onChange={(event) => setNewProduct((prev) => ({ ...prev, notes: event.target.value }))}
                      value={newProduct.notes}
                    />
                  </label>
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
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <select
                    className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) =>
                      setProductFilters((prev) => ({
                        ...prev,
                        category: event.target.value,
                        subcategory: 'all'
                      }))
                    }
                    value={productFilters.category}
                  >
                    <option value="all">All Categories</option>
                    {rootCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="min-h-[36px] border border-neutral-300 bg-white px-2 text-sm"
                    onChange={(event) => setProductFilters((prev) => ({ ...prev, subcategory: event.target.value }))}
                    value={productFilters.subcategory}
                  >
                    <option value="all">All Subcategories</option>
                    {(productFilters.category !== 'all'
                      ? subcategoriesByParent.get(productFilters.category) ?? []
                      : productCategories.filter((category) => !!category.parent_category_id)
                    ).map((subcategory) => (
                      <option key={subcategory.id} value={subcategory.id}>
                        {subcategory.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) => setProductFilters((prev) => ({ ...prev, search: event.target.value }))}
                    placeholder="Search catalog"
                    type="search"
                    value={productFilters.search}
                  />
                </div>
                <div className="overflow-x-auto border border-neutral-300">
                  <table className="min-w-full text-sm">
                    <thead className="bg-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-600">
                      <tr>
                        <th className="border-b border-neutral-200 px-3 py-2">Name</th>
                        <th className="border-b border-neutral-200 px-3 py-2">Category</th>
                        <th className="border-b border-neutral-200 px-3 py-2">Subcategory</th>
                        <th className="border-b border-neutral-200 px-3 py-2">Default Qty</th>
                        <th className="border-b border-neutral-200 px-3 py-2">Cost</th>
                        <th className="border-b border-neutral-200 px-3 py-2">Vendor</th>
                        <th className="border-b border-neutral-200 px-3 py-2">Expand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productsByCategory.map((product) => {
                        const isExpanded = expandedProductId === product.id;
                        return (
                          <Fragment key={product.id}>
                            <tr
                              className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50"
                              onClick={() => setExpandedProductId((prev) => (prev === product.id ? null : product.id))}
                            >
                              <td className="px-3 py-2 font-medium">{product.name}</td>
                              <td className="px-3 py-2">{product.category_id ? categoryById.get(product.category_id)?.name ?? '-' : '-'}</td>
                              <td className="px-3 py-2">{product.subcategory_id ? categoryById.get(product.subcategory_id)?.name ?? '-' : '-'}</td>
                              <td className="px-3 py-2">{product.default_order_quantity}</td>
                              <td className="px-3 py-2">{currency.format(Number(product.default_unit_cost ?? 0))}</td>
                              <td className="px-3 py-2">{product.preferred_vendor_id ? vendorById.get(product.preferred_vendor_id)?.name ?? '-' : '-'}</td>
                              <td className="px-3 py-2">{isExpanded ? 'Hide' : 'Edit'}</td>
                            </tr>
                            {isExpanded ? (
                              <tr className="border-b border-neutral-200 bg-neutral-50">
                                <td className="px-3 py-3" colSpan={7}>
                                  <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                                    <input
                                      className="min-h-[34px] border border-neutral-300 px-2"
                                      onChange={(event) => {
                                        setProducts((prev) => prev.map((entry) => (entry.id === product.id ? { ...entry, name: event.target.value } : entry)));
                                      }}
                                      value={product.name}
                                    />
                                    <select
                                      className="min-h-[34px] border border-neutral-300 bg-white px-2"
                                      onChange={(event) =>
                                        setProducts((prev) =>
                                          prev.map((entry) =>
                                            entry.id === product.id
                                              ? { ...entry, category_id: event.target.value || null, subcategory_id: null }
                                              : entry
                                          )
                                        )
                                      }
                                      value={product.category_id ?? ''}
                                    >
                                      <option value="">Category</option>
                                      {rootCategories.map((category) => (
                                        <option key={category.id} value={category.id}>
                                          {category.name}
                                        </option>
                                      ))}
                                    </select>
                                    <select
                                      className="min-h-[34px] border border-neutral-300 bg-white px-2"
                                      onChange={(event) =>
                                        setProducts((prev) =>
                                          prev.map((entry) =>
                                            entry.id === product.id ? { ...entry, subcategory_id: event.target.value || null } : entry
                                          )
                                        )
                                      }
                                      value={product.subcategory_id ?? ''}
                                    >
                                      <option value="">Subcategory</option>
                                      {(product.category_id ? subcategoriesByParent.get(product.category_id) ?? [] : []).map((subcategory) => (
                                        <option key={subcategory.id} value={subcategory.id}>
                                          {subcategory.name}
                                        </option>
                                      ))}
                                    </select>
                                    <select
                                      className="min-h-[34px] border border-neutral-300 bg-white px-2"
                                      onChange={(event) =>
                                        setProducts((prev) =>
                                          prev.map((entry) =>
                                            entry.id === product.id ? { ...entry, preferred_vendor_id: event.target.value || null } : entry
                                          )
                                        )
                                      }
                                      value={product.preferred_vendor_id ?? ''}
                                    >
                                      <option value="">Vendor</option>
                                      {vendors.map((vendor) => (
                                        <option key={vendor.id} value={vendor.id}>
                                          {vendor.name}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      className="min-h-[34px] border border-neutral-300 px-2"
                                      onChange={(event) =>
                                        setProducts((prev) => prev.map((entry) => (entry.id === product.id ? { ...entry, sku: event.target.value } : entry)))
                                      }
                                      aria-label="SKU"
                                      value={product.sku ?? ''}
                                    />
                                    <input
                                      className="min-h-[34px] border border-neutral-300 px-2"
                                      min={0}
                                      onChange={(event) =>
                                        setProducts((prev) =>
                                          prev.map((entry) =>
                                            entry.id === product.id ? { ...entry, default_unit_cost: event.target.value ? Number(event.target.value) : null } : entry
                                          )
                                        )
                                      }
                                      placeholder="Cost of 1 ordered item"
                                      step="0.01"
                                      type="number"
                                      value={product.default_unit_cost ?? ''}
                                    />
                                    <input
                                      className="min-h-[34px] border border-neutral-300 px-2"
                                      min={1}
                                      onChange={(event) =>
                                        setProducts((prev) =>
                                          prev.map((entry) =>
                                            entry.id === product.id ? { ...entry, units_per_purchase: Math.max(Number(event.target.value) || 1, 1) } : entry
                                          )
                                        )
                                      }
                                      placeholder="Items per ordered item"
                                      step={1}
                                      type="number"
                                      value={product.units_per_purchase}
                                    />
                                    <input
                                      className="min-h-[34px] border border-neutral-300 px-2"
                                      min={1}
                                      onChange={(event) =>
                                        setProducts((prev) =>
                                          prev.map((entry) =>
                                            entry.id === product.id ? { ...entry, default_order_quantity: Math.max(Number(event.target.value) || 1, 1) } : entry
                                          )
                                        )
                                      }
                                      placeholder="Default order qty"
                                      step={1}
                                      type="number"
                                      value={product.default_order_quantity}
                                    />
                                    <input
                                      className="min-h-[34px] border border-neutral-300 px-2 md:col-span-2"
                                      onChange={(event) =>
                                        setProducts((prev) =>
                                          prev.map((entry) =>
                                            entry.id === product.id ? { ...entry, vendor_product_link: event.target.value } : entry
                                          )
                                        )
                                      }
                                      aria-label="Vendor Link"
                                      value={product.vendor_product_link ?? ''}
                                    />
                                    <textarea
                                      className="min-h-[70px] border border-neutral-300 px-2 py-2 md:col-span-4"
                                      onChange={(event) =>
                                        setProducts((prev) =>
                                          prev.map((entry) =>
                                            entry.id === product.id ? { ...entry, notes: event.target.value } : entry
                                          )
                                        )
                                      }
                                      aria-label="Product Notes"
                                      value={product.notes ?? ''}
                                    />
                                  </div>
                                  <div className="mt-2">
                                    <button
                                      className="min-h-[32px] border border-neutral-300 px-3 text-xs hover:bg-neutral-100"
                                      onClick={() => void saveProduct(product)}
                                      type="button"
                                    >
                                      Save Product
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
                    aria-label="Vendor Notes"
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
                    aria-label="Wishlist Notes"
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
              <section className="border-t border-neutral-300 px-4 py-4 md:px-6">
                <h3 className="text-base font-semibold">Product Categories</h3>
                <p className="mt-1 text-sm text-neutral-600">
                  Add a category by name. Drag onto a category to nest it, or drag between categories to keep it top-level.
                </p>
                <div className="mt-3 flex flex-col gap-2 md:flex-row">
                  <label className="flex-1 text-sm text-neutral-700">
                    Category Name
                    <input
                      className="mt-1 min-h-[38px] w-full border border-neutral-300 px-2"
                      onChange={(event) => setNewProductCategory({ name: event.target.value })}
                      value={newProductCategory.name}
                    />
                  </label>
                  <button
                    className="min-h-[38px] border border-brand-maroon bg-brand-maroon px-4 text-sm text-white hover:bg-[#6a0000] md:self-end"
                    onClick={() => void addProductCategory()}
                    type="button"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-4 rounded border border-neutral-300 bg-neutral-50 p-2">
                  {rootCategories.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-neutral-600">No categories yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {rootCategories.map((category) => (
                        <Fragment key={category.id}>
                          <div
                            className={`h-2 rounded ${
                              categoryDropTarget?.id === category.id && categoryDropTarget.position === 'before'
                                ? 'bg-brand-maroon/60'
                                : 'bg-transparent'
                            }`}
                            onDragOver={(event) => {
                              event.preventDefault();
                              setCategoryDropTarget({ id: category.id, position: 'before' });
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              void applyCategoryDrop(category.id, 'before');
                            }}
                          />
                          <article
                            className={`cursor-pointer rounded border px-3 py-2 ${
                              categoryDropTarget?.id === category.id && categoryDropTarget.position === 'inside'
                                ? 'border-brand-maroon bg-brand-maroon/10'
                                : 'border-neutral-300 bg-white'
                            }`}
                            draggable
                            onDragStart={() => setDraggedCategoryId(category.id)}
                            onDragEnd={resetCategoryDragState}
                            onClick={() =>
                              setEditingCategoryDraft({
                                id: category.id,
                                name: category.name,
                                parent_category_id: category.parent_category_id
                              })
                            }
                            onDragOver={(event) => {
                              event.preventDefault();
                              setCategoryDropTarget({ id: category.id, position: 'inside' });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setEditingCategoryDraft({
                                  id: category.id,
                                  name: category.name,
                                  parent_category_id: category.parent_category_id
                                });
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              void applyCategoryDrop(category.id, 'inside');
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <p className="text-sm font-medium">{category.name}</p>
                          </article>

                          <div className="ml-5 mt-1 space-y-1">
                            {(subcategoriesByParent.get(category.id) ?? []).map((subCategory) => (
                              <Fragment key={subCategory.id}>
                                <div
                                  className={`h-2 rounded ${
                                    categoryDropTarget?.id === subCategory.id && categoryDropTarget.position === 'before'
                                      ? 'bg-brand-maroon/60'
                                      : 'bg-transparent'
                                  }`}
                                  onDragOver={(event) => {
                                    event.preventDefault();
                                    setCategoryDropTarget({ id: subCategory.id, position: 'before' });
                                  }}
                                  onDrop={(event) => {
                                    event.preventDefault();
                                    void applyCategoryDrop(subCategory.id, 'before');
                                  }}
                                />
                                <article
                                  className={`cursor-pointer rounded border px-3 py-2 ${
                                    categoryDropTarget?.id === subCategory.id && categoryDropTarget.position === 'inside'
                                      ? 'border-brand-maroon bg-brand-maroon/10'
                                      : 'border-neutral-300 bg-white'
                                  }`}
                                  draggable
                                  onDragStart={() => setDraggedCategoryId(subCategory.id)}
                                  onDragEnd={resetCategoryDragState}
                                  onClick={() =>
                                    setEditingCategoryDraft({
                                      id: subCategory.id,
                                      name: subCategory.name,
                                      parent_category_id: subCategory.parent_category_id
                                    })
                                  }
                                  onDragOver={(event) => {
                                    event.preventDefault();
                                    setCategoryDropTarget({ id: subCategory.id, position: 'inside' });
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault();
                                      setEditingCategoryDraft({
                                        id: subCategory.id,
                                        name: subCategory.name,
                                        parent_category_id: subCategory.parent_category_id
                                      });
                                    }
                                  }}
                                  onDrop={(event) => {
                                    event.preventDefault();
                                    void applyCategoryDrop(subCategory.id, 'inside');
                                  }}
                                  role="button"
                                  tabIndex={0}
                                >
                                  <p className="text-sm font-medium">{subCategory.name}</p>
                                </article>
                                <div
                                  className={`h-2 rounded ${
                                    categoryDropTarget?.id === subCategory.id && categoryDropTarget.position === 'after'
                                      ? 'bg-brand-maroon/60'
                                      : 'bg-transparent'
                                  }`}
                                  onDragOver={(event) => {
                                    event.preventDefault();
                                    setCategoryDropTarget({ id: subCategory.id, position: 'after' });
                                  }}
                                  onDrop={(event) => {
                                    event.preventDefault();
                                    void applyCategoryDrop(subCategory.id, 'after');
                                  }}
                                />
                              </Fragment>
                            ))}
                          </div>

                          <div
                            className={`h-2 rounded ${
                              categoryDropTarget?.id === category.id && categoryDropTarget.position === 'after'
                                ? 'bg-brand-maroon/60'
                                : 'bg-transparent'
                            }`}
                            onDragOver={(event) => {
                              event.preventDefault();
                              setCategoryDropTarget({ id: category.id, position: 'after' });
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              void applyCategoryDrop(category.id, 'after');
                            }}
                          />
                        </Fragment>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </section>
          )}
      </section>

      {editingCategoryDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl border border-neutral-300 bg-white">
            <header className="border-b border-neutral-300 px-4 py-3">
              <h3 className="text-base font-semibold">Edit Category</h3>
            </header>
            <div className="grid grid-cols-1 gap-3 px-4 py-4">
              <label className="text-sm text-neutral-700">
                Name
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setEditingCategoryDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                  type="text"
                  value={editingCategoryDraft.name}
                />
              </label>
              <label className="text-sm text-neutral-700">
                Parent
                <select
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 bg-white px-2"
                  onChange={(event) =>
                    setEditingCategoryDraft((prev) =>
                      prev ? { ...prev, parent_category_id: event.target.value || null } : prev
                    )
                  }
                  value={editingCategoryDraft.parent_category_id ?? ''}
                >
                  <option value="">Main category</option>
                  {rootCategories
                    .filter((category) => category.id !== editingCategoryDraft.id)
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <footer className="flex justify-end gap-2 border-t border-neutral-300 px-4 py-3">
              <button
                className="min-h-[34px] border border-neutral-300 px-3 text-sm hover:bg-neutral-100"
                onClick={() => setEditingCategoryDraft(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000]"
                onClick={() => void saveProductCategoryEdit()}
                type="button"
              >
                Save
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {cancelOrderTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md border border-neutral-300 bg-white">
            <header className="border-b border-neutral-300 px-4 py-3">
              <h3 className="text-base font-semibold">Cancel Order</h3>
            </header>
            <div className="px-4 py-4">
              <p className="text-sm text-neutral-700">
                Cancel <span className="font-semibold">{cancelOrderTarget.order_number}</span>? This will set status to cancelled.
              </p>
            </div>
            <footer className="flex justify-end gap-2 border-t border-neutral-300 px-4 py-3">
              <button
                className="min-h-[34px] border border-neutral-300 px-3 text-sm hover:bg-neutral-100"
                onClick={() => setCancelOrderTarget(null)}
                type="button"
              >
                Keep Order
              </button>
              <button
                className="min-h-[34px] border border-red-700 bg-red-700 px-3 text-sm text-white hover:bg-red-800"
                onClick={() => void cancelOrderQuick(cancelOrderTarget)}
                type="button"
              >
                Confirm Cancel
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {showCreateOrderModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl border border-neutral-300 bg-white">
            <header className="border-b border-neutral-300 px-4 py-3">
              <h3 className="text-base font-semibold">Create Order</h3>
            </header>
            <div className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-2">
              <label className="text-sm text-neutral-700">
                Vendor
                <select
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 bg-white px-2"
                  onChange={(event) => setNewOrderDraft((prev) => ({ ...prev, vendor_id: event.target.value }))}
                  value={newOrderDraft.vendor_id}
                >
                  <option value="">Select vendor</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-neutral-700">
                Priority
                <select
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 bg-white px-2"
                  onChange={(event) => setNewOrderDraft((prev) => ({ ...prev, priority: event.target.value as DbPriority }))}
                  value={newOrderDraft.priority}
                >
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label className="text-sm text-neutral-700">
                ASAP
                <div className="mt-2 flex items-center gap-2">
                  <input
                    checked={newOrderDraft.asap}
                    onChange={(event) => setNewOrderDraft((prev) => ({ ...prev, asap: event.target.checked }))}
                    type="checkbox"
                  />
                  <span className="text-sm text-neutral-700">Mark as ASAP (no requested pickup date)</span>
                </div>
              </label>
              <label className="text-sm text-neutral-700">
                Date Placed
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setNewOrderDraft((prev) => ({ ...prev, date_placed: event.target.value }))}
                  type="date"
                  value={newOrderDraft.date_placed}
                />
              </label>
              <label className="text-sm text-neutral-700 md:col-span-1">
                Requested Pickup Date
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setNewOrderDraft((prev) => ({ ...prev, requested_pickup_date: event.target.value }))}
                  disabled={newOrderDraft.asap}
                  type="date"
                  value={newOrderDraft.requested_pickup_date}
                />
              </label>
              <label className="text-sm text-neutral-700">
                Expected Arrival
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setNewOrderDraft((prev) => ({ ...prev, expected_arrival_date: event.target.value }))}
                  type="date"
                  value={newOrderDraft.expected_arrival_date}
                />
              </label>
              <label className="text-sm text-neutral-700 md:col-span-3">
                Reason
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setNewOrderDraft((prev) => ({ ...prev, reason: event.target.value }))}
                  type="text"
                  value={newOrderDraft.reason}
                />
              </label>
              <label className="text-sm text-neutral-700 md:col-span-3">
                Notes
                <textarea
                  className="mt-1 min-h-[90px] w-full border border-neutral-300 px-2 py-2"
                  onChange={(event) => setNewOrderDraft((prev) => ({ ...prev, notes: event.target.value }))}
                  value={newOrderDraft.notes}
                />
              </label>
            </div>
            <footer className="flex justify-end gap-2 border-t border-neutral-300 px-4 py-3">
              <button
                className="min-h-[34px] border border-neutral-300 px-3 text-sm hover:bg-neutral-100"
                onClick={() => setShowCreateOrderModal(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000]"
                onClick={() => void createOrder()}
                type="button"
              >
                Confirm Create Order
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {showEditOrderModal && editingOrderDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl border border-neutral-300 bg-white">
            <header className="border-b border-neutral-300 px-4 py-3">
              <h3 className="text-base font-semibold">Edit Order</h3>
            </header>
            <div className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-2">
              <label className="text-sm text-neutral-700">
                Vendor
                <select
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 bg-white px-2"
                  onChange={(event) => setEditingOrderDraft((prev) => (prev ? { ...prev, vendor_id: event.target.value } : prev))}
                  value={editingOrderDraft.vendor_id}
                >
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-neutral-700">
                Status
                <select
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 bg-white px-2"
                  onChange={(event) => setEditingOrderDraft((prev) => (prev ? { ...prev, status: event.target.value as DbOrderStatus } : prev))}
                  value={editingOrderDraft.status}
                >
                  {ORDER_STATUSES.map((status) => (
                    <option key={status} value={status}>{formatLabel(status)}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-neutral-700">
                Priority
                <select
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 bg-white px-2"
                  onChange={(event) => setEditingOrderDraft((prev) => (prev ? { ...prev, priority: event.target.value as DbPriority } : prev))}
                  value={editingOrderDraft.priority}
                >
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <label className="text-sm text-neutral-700">
                Date Placed
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setEditingOrderDraft((prev) => (prev ? { ...prev, date_placed: event.target.value || null } : prev))}
                  type="date"
                  value={editingOrderDraft.date_placed ?? ''}
                />
              </label>
              <label className="text-sm text-neutral-700">
                Requested Pickup Date
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setEditingOrderDraft((prev) => (prev ? { ...prev, requested_pickup_date: event.target.value || null } : prev))}
                  type="date"
                  value={editingOrderDraft.requested_pickup_date ?? ''}
                />
              </label>
              <label className="text-sm text-neutral-700">
                Expected Arrival
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setEditingOrderDraft((prev) => (prev ? { ...prev, expected_arrival_date: event.target.value || null } : prev))}
                  type="date"
                  value={editingOrderDraft.expected_arrival_date ?? ''}
                />
              </label>
              <label className="text-sm text-neutral-700 md:col-span-2">
                Reason
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setEditingOrderDraft((prev) => (prev ? { ...prev, reason: event.target.value } : prev))}
                  type="text"
                  value={editingOrderDraft.reason ?? ''}
                />
              </label>
              <label className="text-sm text-neutral-700 md:col-span-2">
                Notes
                <textarea
                  className="mt-1 min-h-[80px] w-full border border-neutral-300 px-2 py-2"
                  onChange={(event) => setEditingOrderDraft((prev) => (prev ? { ...prev, notes: event.target.value } : prev))}
                  value={editingOrderDraft.notes ?? ''}
                />
              </label>
            </div>
            <footer className="flex justify-end gap-2 border-t border-neutral-300 px-4 py-3">
              <button
                className="min-h-[34px] border border-neutral-300 px-3 text-sm hover:bg-neutral-100"
                onClick={() => {
                  setShowEditOrderModal(false);
                  setEditingOrderDraft(null);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000]"
                onClick={() => void saveEditOrderModal()}
                type="button"
              >
                Save
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {lineModalMode && lineModalDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl border border-neutral-300 bg-white">
            <header className="border-b border-neutral-300 px-4 py-3">
              <h3 className="text-base font-semibold">{lineModalMode === 'add' ? 'Add Catalog Item' : 'Edit Line Item'}</h3>
            </header>
            <div className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-3">
              <label className="text-sm text-neutral-700 md:col-span-3">
                Product
                <div className="relative mt-1" ref={lineProductDropdownRef}>
                  <button
                  className="flex min-h-[36px] w-full items-center justify-between border border-neutral-300 bg-white px-2 text-left"
                    disabled={lineModalMode === 'edit'}
                    onClick={() => setLineProductDropdownOpen((prev) => !prev)}
                    type="button"
                  >
                    <span className={lineModalDraft.product_id ? 'text-neutral-900' : 'text-neutral-500'}>
                      {lineModalDraft.product_id ? productById.get(lineModalDraft.product_id)?.name ?? 'Selected product' : 'Select product'}
                    </span>
                    <span className={`text-xs text-neutral-600 transition-transform ${lineProductDropdownOpen ? 'rotate-180' : ''}`}>▼</span>
                  </button>
                  <div
                    className={`absolute left-0 right-0 top-[calc(100%+4px)] z-20 border border-neutral-300 bg-white shadow transition-all duration-200 ${
                      lineProductDropdownOpen
                        ? 'pointer-events-auto translate-y-0 opacity-100'
                        : 'pointer-events-none -translate-y-1 opacity-0'
                    }`}
                  >
                    <div className="border-b border-neutral-200 p-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                        Search Product
                        <input
                          className="mt-1 min-h-[34px] w-full border border-neutral-300 px-2 text-sm"
                          onChange={(event) => setLineProductQuery(event.target.value)}
                          onFocus={() => setLineProductDropdownOpen(true)}
                          value={lineProductQuery}
                        />
                      </label>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {vendorScopedLineProductOptions.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-neutral-500">No catalog products available for this vendor.</p>
                      ) : (
                        vendorScopedLineProductOptions.map((product) => (
                          <button
                            className="block w-full border-b border-neutral-100 px-3 py-2 text-left text-sm hover:bg-neutral-100"
                            key={product.id}
                            onClick={() => applyLineProductSelection(product)}
                            type="button"
                          >
                            <p className="font-medium">{product.name}</p>
                            <p className="text-xs text-neutral-500">
                              {product.sku ? `SKU: ${product.sku}` : 'No SKU'}
                              {product.default_unit_cost !== null ? ` • ${currency.format(product.default_unit_cost)}` : ''}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {lineModalMode === 'edit'
                    ? 'Product is locked after adding. To change it, remove this line and add a new one.'
                    : 'Only catalog items configured for this order vendor are shown.'}
                </p>
                {lineModalErrors.product_id ? <p className="mt-1 text-xs text-red-700">{lineModalErrors.product_id}</p> : null}
              </label>

              <label className="text-sm text-neutral-700">
                How Many Ordered
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  min={1}
                  onChange={(event) => setLineModalDraft((prev) => (prev ? { ...prev, quantity: Number(event.target.value) } : prev))}
                  step={1}
                  type="number"
                  value={lineModalDraft.quantity}
                />
                {lineModalErrors.quantity ? <p className="mt-1 text-xs text-red-700">{lineModalErrors.quantity}</p> : null}
              </label>

              <label className="text-sm text-neutral-700">
                Cost Of 1 Ordered Item
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  disabled
                  readOnly
                  type="text"
                  value={currency.format(lineModalDraft.unit_price)}
                />
                <p className="mt-1 text-xs text-neutral-500">Managed in Products.</p>
              </label>

              <label className="text-sm text-neutral-700">
                Items Per Ordered Item
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  disabled
                  readOnly
                  type="text"
                  value={String(lineModalDraft.units_per_purchase)}
                />
                <p className="mt-1 text-xs text-neutral-500">Managed in Products.</p>
              </label>

              <label className="text-sm text-neutral-700 md:col-span-2">
                Link
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  disabled
                  readOnly
                  type="text"
                  value={lineModalDraft.product_link}
                />
                <p className="mt-1 text-xs text-neutral-500">Managed in Products.</p>
              </label>
            </div>
            <footer className="flex justify-end gap-2 border-t border-neutral-300 px-4 py-3">
              <button
                className="min-h-[34px] border border-neutral-300 px-3 text-sm hover:bg-neutral-100"
                onClick={closeLineModal}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000]"
                onClick={() => void saveLineModal()}
                type="button"
              >
                Save
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {lineFilesModalLineId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl border border-neutral-300 bg-white">
            <header className="border-b border-neutral-300 px-4 py-3">
              <h3 className="text-base font-semibold">Line Item Files</h3>
              <p className="mt-1 text-xs text-neutral-600">
                {lineById.get(lineFilesModalLineId)?.product_id
                  ? productById.get(lineById.get(lineFilesModalLineId)?.product_id ?? '')?.name ?? 'Selected product'
                  : 'No product'}
              </p>
            </header>
            <div className="grid grid-cols-1 gap-2 border-b border-neutral-300 px-4 py-4 md:grid-cols-[1fr_2fr_auto]">
              <label className="text-sm text-neutral-700">
                File
                <input
                  className="mt-1 block w-full border border-neutral-300 p-2 text-sm"
                  onChange={(event) =>
                    setLineAttachmentDrafts((prev) => ({
                      ...prev,
                      [lineFilesModalLineId]: {
                        file: event.target.files?.[0] ?? null,
                        description: prev[lineFilesModalLineId]?.description ?? ''
                      }
                    }))
                  }
                  type="file"
                />
              </label>
              <label className="text-sm text-neutral-700">
                File Description
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setLineAttachmentDrafts((prev) => ({
                      ...prev,
                      [lineFilesModalLineId]: {
                        file: prev[lineFilesModalLineId]?.file ?? null,
                        description: event.target.value
                      }
                    }))
                  }
                  value={lineAttachmentDrafts[lineFilesModalLineId]?.description ?? ''}
                />
              </label>
              <div className="flex items-end">
                <button
                  className="min-h-[36px] w-full border border-neutral-700 bg-neutral-800 px-3 text-xs text-white hover:bg-neutral-900"
                  disabled={lineAttachmentUploadingIds.includes(lineFilesModalLineId)}
                  onClick={() => void uploadLineAttachment(lineFilesModalLineId)}
                  type="button"
                >
                  {lineAttachmentUploadingIds.includes(lineFilesModalLineId) ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>
            <div className="max-h-[50vh] space-y-2 overflow-y-auto px-4 py-4">
              {(lineAttachmentsByLine.get(lineFilesModalLineId) ?? []).map((entry) => {
                const publicUrl = entry.attachment
                  ? supabase.storage.from(entry.attachment.bucket).getPublicUrl(entry.attachment.storage_path).data.publicUrl
                  : '';
                return (
                  <article className="flex items-center justify-between border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs" key={entry.id}>
                    <div className="min-w-0">
                      <p className="font-medium">{entry.attachment?.file_name ?? 'Attachment'}</p>
                      <p className="text-neutral-600">{entry.description || 'No description'}</p>
                    </div>
                    {publicUrl ? (
                      <div className="flex items-center gap-1">
                        <a className="border border-neutral-400 px-2 py-1 hover:bg-white" href={publicUrl} rel="noreferrer" target="_blank">
                          Open
                        </a>
                        <button
                          className="border border-red-700 px-2 py-1 text-red-700 hover:bg-red-50"
                          onClick={() => void removeLineAttachment(entry)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <button
                        className="border border-red-700 px-2 py-1 text-red-700 hover:bg-red-50"
                        onClick={() => void removeLineAttachment(entry)}
                        type="button"
                      >
                        Delete
                      </button>
                    )}
                  </article>
                );
              })}
              {(lineAttachmentsByLine.get(lineFilesModalLineId) ?? []).length === 0 ? (
                <p className="text-sm text-neutral-600">No files uploaded for this line item yet.</p>
              ) : null}
            </div>
            <footer className="flex justify-end gap-2 border-t border-neutral-300 px-4 py-3">
              <button
                className="min-h-[34px] border border-neutral-300 px-3 text-sm hover:bg-neutral-100"
                onClick={() => setLineFilesModalLineId(null)}
                type="button"
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {promptConvertDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl border border-neutral-300 bg-white">
            <header className="border-b border-neutral-300 px-4 py-3">
              <h3 className="text-base font-semibold">Confirm Move To Order</h3>
              <p className="mt-1 text-sm text-neutral-600">{promptConvertDraft.product_name}</p>
            </header>
            <div className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-2">
              <label className="text-sm text-neutral-700">
                Suggested Qty
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  min={1}
                  onChange={(event) =>
                    setPromptConvertDraft((prev) =>
                      prev ? { ...prev, quantity: Math.max(Number(event.target.value) || 1, 1) } : prev
                    )
                  }
                  step={1}
                  type="number"
                  value={promptConvertDraft.quantity}
                />
              </label>

              <label className="text-sm text-neutral-700">
                Unit Price
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  min={0}
                  onChange={(event) =>
                    setPromptConvertDraft((prev) =>
                      prev ? { ...prev, unit_price: Math.max(Number(event.target.value) || 0, 0) } : prev
                    )
                  }
                  step="0.01"
                  type="number"
                  value={promptConvertDraft.unit_price}
                />
              </label>

              <label className="text-sm text-neutral-700">
                Vendor
                <select
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 bg-white px-2"
                  onChange={(event) =>
                    setPromptConvertDraft((prev) =>
                      prev ? { ...prev, vendor_id: event.target.value } : prev
                    )
                  }
                  value={promptConvertDraft.vendor_id}
                >
                  <option value="">Unassigned</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-neutral-700">
                Priority
                <select
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 bg-white px-2"
                  onChange={(event) =>
                    setPromptConvertDraft((prev) =>
                      prev ? { ...prev, priority: event.target.value as DbPriority } : prev
                    )
                  }
                  value={promptConvertDraft.priority}
                >
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>

              <label className="text-sm text-neutral-700">
                Requested Pickup Date
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setPromptConvertDraft((prev) =>
                      prev ? { ...prev, requested_pickup_date: event.target.value } : prev
                    )
                  }
                  type="date"
                  value={promptConvertDraft.requested_pickup_date}
                />
              </label>

              <label className="text-sm text-neutral-700">
                Reason
                <input
                  className="mt-1 min-h-[36px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setPromptConvertDraft((prev) =>
                      prev ? { ...prev, reason: event.target.value } : prev
                    )
                  }
                  type="text"
                  value={promptConvertDraft.reason}
                />
              </label>

              <label className="text-sm text-neutral-700 md:col-span-2">
                Notes
                <textarea
                  className="mt-1 min-h-[86px] w-full border border-neutral-300 px-2 py-2"
                  onChange={(event) =>
                    setPromptConvertDraft((prev) =>
                      prev ? { ...prev, notes: event.target.value } : prev
                    )
                  }
                  value={promptConvertDraft.notes}
                />
              </label>
            </div>
            <footer className="flex justify-end gap-2 border-t border-neutral-300 px-4 py-3">
              <button
                className="min-h-[34px] border border-neutral-300 px-3 text-sm hover:bg-neutral-100"
                onClick={() => setPromptConvertDraft(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-[34px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white hover:bg-[#6a0000]"
                onClick={() => void confirmPromptConvert()}
                type="button"
              >
                Confirm & Create Order
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </DepartmentShell>
  );
}
