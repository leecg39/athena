import { serve } from "inngest/next";
import { inngest, functions } from "@athena/jobs";

export const { GET, POST, PUT } = serve({ client: inngest, functions });
