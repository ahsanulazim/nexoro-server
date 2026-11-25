export const PERMISSION_MODULES = [
  // Operations & Communication
  {
    id: "orders",
    label: "Orders",
    category: "Operations",
    description: "Manage client orders, order status, tasks, and costs",
    route: "/dashboard/orders",
  },
  {
    id: "inbox",
    label: "Inbox / Messages",
    category: "Operations",
    description: "Access customer conversations, chat, and deal closing",
    route: "/dashboard/inbox",
  },
  {
    id: "queries",
    label: "Contact Queries",
    category: "Operations",
    description: "Manage client queries and messages submitted from website contact form",
    route: "/dashboard/queries",
  },
  {
    id: "projects",
    label: "Projects",
    category: "Operations",
    description: "Manage ongoing client projects, tasks, and files",
    route: "/dashboard/projects",
  },
  {
    id: "clients",
    label: "Clients",
    category: "Operations",
    description: "View and manage clients directory and CRM records",
    route: "/dashboard/clients",
  },
  {
    id: "points",
    label: "Points & Leaderboard",
    category: "Operations",
    description: "View team performance, leaderboard, and reward points",
    route: "/dashboard/points",
  },

  // Content & Marketing
  {
    id: "blogs",
    label: "Blogs",
    category: "Content",
    description: "Create, edit, and publish blog articles",
    route: "/dashboard/blogs",
  },
  {
    id: "portfolio",
    label: "Portfolio",
    category: "Content",
    description: "Manage portfolio items and case studies",
    route: "/dashboard/portfolio",
  },
  {
    id: "services",
    label: "Services",
    category: "Content",
    description: "Manage service offerings and categories",
    route: "/dashboard/services",
  },
  {
    id: "pricing",
    label: "Pricing Plans",
    category: "Content",
    description: "Manage service pricing tiers and plans",
    route: "/dashboard/pricing",
  },
  {
    id: "sliders",
    label: "Sliders & Banners",
    category: "Content",
    description: "Manage homepage banners and promotional sliders",
    route: "/dashboard/sliders",
  },
  {
    id: "review",
    label: "Reviews",
    category: "Content",
    description: "Manage customer reviews and testimonials",
    route: "/dashboard/review",
  },

  // Finance & Management
  {
    id: "expenses",
    label: "Expenses",
    category: "Finance & Admin",
    description: "View and manage business expenses and financial records",
    route: "/dashboard/expenses",
  },
  {
    id: "team",
    label: "Team",
    category: "Finance & Admin",
    description: "View internal team member directory",
    route: "/dashboard/team",
  },
  {
    id: "users",
    label: "User Management",
    category: "Finance & Admin",
    description: "Manage customer accounts, roles, and member permissions",
    route: "/dashboard/users",
  },
];

export const ALL_PERMISSION_IDS = PERMISSION_MODULES.map((m) => m.id);

// Default permissions for standard team members (preserves backward compatibility)
export const DEFAULT_MEMBER_PERMISSIONS = [
  "orders",
  "inbox",
  "queries",
  "blogs",
  "projects",
  "points",
  "portfolio",
  "services",
  "pricing",
  "clients",
];

// Presets for quick selection in Admin UI
export const PERMISSION_PRESETS = [
  {
    name: "Full Access",
    description: "Access to all modules and routes",
    permissions: ALL_PERMISSION_IDS,
  },
  {
    name: "Standard Member",
    description: "Default member permissions (Operations + Content)",
    permissions: DEFAULT_MEMBER_PERMISSIONS,
  },
  {
    name: "Support & Communication",
    description: "Inbox, Queries, Orders, Clients, Points",
    permissions: ["inbox", "queries", "orders", "clients", "points"],
  },
  {
    name: "Project & Operations",
    description: "Orders, Projects, Clients, Points",
    permissions: ["orders", "projects", "clients", "points"],
  },
  {
    name: "Content & Marketing",
    description: "Blogs, Portfolio, Services, Pricing, Sliders, Reviews",
    permissions: ["blogs", "portfolio", "services", "pricing", "sliders", "review"],
  },
  {
    name: "Finance & Operations",
    description: "Expenses, Orders, Clients",
    permissions: ["expenses", "orders", "clients"],
  },
];
