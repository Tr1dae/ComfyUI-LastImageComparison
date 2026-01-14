/**
 * Frontend extension for ImagePushOutput node.
 * Adds a "Open Viewer for this ID" button that opens the viewer in a new tab.
 */

import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "DevImage.ImagePushOutput",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== "ImagePushOutput") {
            return;
        }

        const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalOnNodeCreated?.apply(this, arguments);

            // Find the viewer_id widget
            const viewerIdWidget = this.widgets?.find((w) => w.name === "viewer_id");
            if (!viewerIdWidget) {
                return;
            }

            // Create button widget
            const openViewerButton = this.addWidget(
                "button",
                "Open Viewer for this ID",
                null,
                () => {
                    // Get current viewer_id value
                    const viewerId = viewerIdWidget.value || "default";

                    // Build viewer URL using current origin + viewer path
                    const viewerUrl = `${window.location.origin}/simple_ui_viewer?id=${encodeURIComponent(viewerId)}`;

                    // Open in new tab
                    window.open(viewerUrl, "_blank");
                },
                {
                    serialize: false,
                }
            );

            // Store reference for potential cleanup
            this.openViewerButton = openViewerButton;
        };
    },
});
