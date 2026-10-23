// The owner's set-up checklist: which steps exist and where each one is done.

export interface SetupStatus {
  demo: boolean;
  steps: Record<string, boolean>;
}

interface Step {
  key: string;
  title: string;
  desc: string;
  href?: string;
  action?: 'password';
  optional?: boolean;
}

export const STEPS: Step[] = [
  { key: 'branding', title: 'Name, logo & colours', desc: 'Your restaurant name, logo and brand colour on every screen and bill.', href: '#/settings?tab=branding' },
  { key: 'business', title: 'Business details', desc: 'Address, phone, GSTIN and FSSAI printed on bills.', href: '#/settings?tab=profile' },
  { key: 'billing', title: 'Billing & tax', desc: 'Currency, service and packaging charges, invoice prefix, loyalty points.', href: '#/settings?tab=billing' },
  { key: 'floor', title: 'Floor & tables', desc: 'Add dining areas (Ground floor, Terrace…) and their tables.', href: '#/settings?tab=floor' },
  { key: 'menu', title: 'Menu', desc: 'Categories and dishes with prices, GST, veg / non-veg and portions.', href: '#/menu' },
  { key: 'inventory', title: 'Inventory & recipes', desc: 'Raw materials and recipes so stock is deducted automatically.', href: '#/inventory', optional: true },
  { key: 'staff', title: 'Staff logins', desc: 'Accounts for managers, cashiers, captains and the kitchen screen.', href: '#/staff' },
  { key: 'password', title: 'Change the admin password', desc: 'The demo password “admin123” is still active on your account.', action: 'password' },
];
