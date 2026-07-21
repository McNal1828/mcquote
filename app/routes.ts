import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("about", "routes/about.tsx"),
    route("api/download", "routes/api.download.ts"),
    route("api/home/download", "routes/api.home.download.ts"),
    route("quoting", "routes/quoting.tsx"),
    route("ams", "routes/ams.tsx"),
    route("partners", "routes/partners.tsx"),
    route("products", "routes/products.tsx"),
    route("contacts", "routes/contacts.tsx"),
    route("dist", "routes/dist.tsx"),
    route("stats", "routes/stats_partner.tsx"),
    route("stats_revenue", "routes/stats_revenue.tsx"),
    route("history/:id", "routes/history.tsx"),
    route("exchange_rate", "routes/exchange_rate.tsx"),
] satisfies RouteConfig;
