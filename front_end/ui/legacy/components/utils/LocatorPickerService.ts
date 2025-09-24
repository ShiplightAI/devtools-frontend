// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Common from '../../../../core/common/common.js';
import * as Protocol from '../../../../generated/protocol.js';
import * as SDK from '../../../../core/sdk/sdk.js';
import * as UI from '../../legacy.js';

export interface LocatorPickerListener {
  onPickModeChanged(isActive: boolean): void;
  onLocatorHovered?(locator: string, elementInfo: {tagName: string, id: string, className: string}): void;
  onLocatorSelected?(locator: string): void;
}

export class LocatorPickerService extends Common.ObjectWrapper.ObjectWrapper<EventTypes> {
  private static instanceObject: LocatorPickerService | null = null;
  private isPickingMode: boolean = false;
  private pickerListeners: Set<LocatorPickerListener> = new Set();
  private selectedNode: SDK.DOMModel.DOMNode | null = null;

  private constructor() {
    super();

    // Listen for node selection changes
    UI.Context.Context.instance().addFlavorChangeListener(
      SDK.DOMModel.DOMNode,
      this.onNodeSelected,
      this
    );

    // Listen for hover events during inspect mode
    SDK.TargetManager.TargetManager.instance().addModelListener(
      SDK.OverlayModel.OverlayModel,
      SDK.OverlayModel.Events.HIGHLIGHT_NODE_REQUESTED,
      this.onNodeHighlighted,
      this
    );
  }

  static instance(): LocatorPickerService {
    if (!LocatorPickerService.instanceObject) {
      LocatorPickerService.instanceObject = new LocatorPickerService();
    }
    return LocatorPickerService.instanceObject;
  }

  addListener(listener: LocatorPickerListener): void {
    this.pickerListeners.add(listener);
    // Notify listener of current state
    listener.onPickModeChanged(this.isPickingMode);
  }

  removeListener(listener: LocatorPickerListener): void {
    this.pickerListeners.delete(listener);
  }

  isInPickMode(): boolean {
    return this.isPickingMode;
  }

  async startPickMode(): Promise<void> {
    if (this.isPickingMode) {
      return;
    }

    this.isPickingMode = true;

    // Start element selection mode
    const models = SDK.TargetManager.TargetManager.instance().models(SDK.OverlayModel.OverlayModel);
    if (models.length > 0) {
      // Show detailed tooltip during inspection
      await models[0].setInspectMode(Protocol.Overlay.InspectMode.SearchForNode, true);
    }

    // Notify all listeners
    for (const listener of this.pickerListeners) {
      listener.onPickModeChanged(true);
    }

    // Notify parent frame that picking started
    this.sendMessageToParent({
      type: 'pickingStarted',
      language: 'JavaScript'
    });
  }

  // Public method for user-initiated cancellation (ESC key, toggle button, etc.)
  async cancelPickMode(): Promise<void> {
    if (!this.isPickingMode) {
      return;
    }

    // Stop picking mode
    await this.stopPickMode();

    // Send cancellation message to parent frame
    this.sendMessageToParent({
      type: 'pickingStopped'
    });
  }

  // Cancel pick mode without sending cancellation message to parent frame
  async stopPickMode(): Promise<void> {
    if (!this.isPickingMode) {
      return;
    }

    this.isPickingMode = false;

    // Cancel inspect mode
    const models = SDK.TargetManager.TargetManager.instance().models(SDK.OverlayModel.OverlayModel);
    if (models.length > 0) {
      await models[0].setInspectMode(Protocol.Overlay.InspectMode.None);
    }

    // Notify all listeners
    for (const listener of this.pickerListeners) {
      listener.onPickModeChanged(false);
    }
    // Note: Does NOT send pickingStopped message - that's only for cancellations
  }

  private async onNodeHighlighted(event: Common.EventTarget.EventTargetEvent<SDK.DOMModel.DOMNode>): Promise<void> {
    if (!this.isPickingMode) {
      return;
    }

    const node = event.data;
    if (!node) {
      return;
    }


    try {
      // Generate locator for the hovered node
      const locator = await this.generatePlaywrightLocator(node);

      const elementInfo = {
        tagName: node.localName(),
        id: node.getAttribute('id') || '',
        className: node.getAttribute('class') || ''
      };

      // Notify listeners
      for (const listener of this.pickerListeners) {
        if (listener.onLocatorHovered) {
          listener.onLocatorHovered(locator, elementInfo);
        }
      }

      // Send hover update to parent frame
      this.sendMessageToParent({
        type: 'locatorHover',
        locator: locator,
        language: 'JavaScript',
        elementInfo: elementInfo
      });
    } catch (error) {
      console.error('Failed to generate locator for hovered element:', error);
    }
  }

  private async onNodeSelected(): Promise<void> {
    const node = UI.Context.Context.instance().flavor(SDK.DOMModel.DOMNode);
    if (!node || node === this.selectedNode) {
      return;
    }

    this.selectedNode = node;

    // If we're in picking mode, generate locator and exit pick mode
    if (this.isPickingMode) {
      try {
        const locator = await this.generatePlaywrightLocator(node);

        // Notify listeners
        for (const listener of this.pickerListeners) {
          if (listener.onLocatorSelected) {
            listener.onLocatorSelected(locator);
          }
        }

        // Send to parent frame
        this.sendMessageToParent({
          type: 'locatorGenerated',
          locator: locator,
          language: 'JavaScript'
        });

        await this.stopPickMode();
      } catch (error) {
        console.error('Failed to generate locator for selected element:', error);
      }
    }
  }

  private async generatePlaywrightLocator(node: SDK.DOMModel.DOMNode): Promise<string> {
    const object = await node.resolveToObject();
    if (!object) {
      throw new Error('Failed to resolve node to object');
    }

    try {
      const result = await object.callFunction(function(this: Element) {
        // Check if playwright object is available
        if (typeof (window as any).playwright !== 'undefined' && (window as any).playwright.generateLocator) {
          const locator = (window as any).playwright.generateLocator(this);
          return locator;
        }

        // Fallback error if playwright is not available
        throw new Error('playwright.generateLocator is not available. Set PWDEBUG=console environment variable when running the browser.');
      });

      const locator = result.object?.value;
      result.object?.release();

      if (!locator) {
        throw new Error('playwright.generateLocator returned null');
      }

      return locator as string;
    } catch (error) {
      throw error;
    }
  }

  private sendMessageToParent(message: object): void {
    if (window.parent !== window) {
      window.parent.postMessage(message, '*');
    }

    // Also send to top frame if different from parent (for nested iframes)
    if (window.top && window.top !== window && window.top !== window.parent) {
      window.top.postMessage(message, '*');
    }
  }
}

// Event types for ObjectWrapper
export const enum Events {
  PICK_MODE_CHANGED = 'pickModeChanged',
}

export type EventTypes = {
  [Events.PICK_MODE_CHANGED]: boolean,
};