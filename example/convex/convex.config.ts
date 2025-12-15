import { defineApp } from "convex/server";
import databaseChat from "./databaseChat/convex.config";

const app = defineApp();
app.use(databaseChat);

export default app;
