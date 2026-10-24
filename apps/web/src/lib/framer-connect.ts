import "server-only";
import type { FramerConnect } from "@athena/core/content";

/**
 * Framer Server API through the official framer-api package. It connects only
 * to Framer's own endpoint (the project id is a parameter, not a host), and is
 * loaded when someone actually publishes to Framer.
 */
export const framerConnect: FramerConnect = async (projectId, apiKey) => {
  const { connect } = await import("framer-api");
  const framer = await connect(projectId, apiKey);
  return {
    getCollections: async () =>
      (await framer.getCollections()).map((c) => ({
        id: c.id,
        name: c.name,
        managedBy: c.managedBy,
        getFields: () => c.getFields(),
        getItems: () => c.getItems(),
        addItems: (items) => c.addItems(items),
      })),
    getUnpublishedPageChanges: async () => (await framer.getUnpublishedPageChanges()).map((p) => ({ path: p.path, status: p.status })),
    publish: () => framer.publish(),
    getDeployment: (deploymentId) => framer.getDeployment(deploymentId),
    deploy: (deploymentId) => framer.deploy(deploymentId),
    disconnect: () => framer.disconnect(),
  };
};
