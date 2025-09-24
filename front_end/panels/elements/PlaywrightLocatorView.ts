// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Portions of this file are adapted from Playwright
// Copyright (c) Microsoft Corporation, Apache License 2.0

import * as Host from '../../core/host/host.js';
import * as i18n from '../../core/i18n/i18n.js';
import * as UI from '../../ui/legacy/legacy.js';
import {LocatorPickerService, LocatorPickerListener} from '../../ui/legacy/components/utils/LocatorPickerService.js';
import playwrightLocatorStyles from './playwrightLocatorView.css.js';

const UIStrings = {
  pickElement: 'Pick element',
  copyLocator: 'Copy',
  copiedToClipboard: 'Copied!',
  playwrightLocator: 'Playwright Locator',
  locatorWillAppearHere: 'Locator will appear here...',
};

const str_ = i18n.i18n.registerUIStrings('panels/elements/PlaywrightLocatorView.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);

export class PlaywrightLocatorView extends UI.Widget.VBox implements LocatorPickerListener {
  private locatorInput: UI.Toolbar.ToolbarInput;
  private pickButton: UI.Toolbar.ToolbarToggle;
  private copyButton: UI.Toolbar.ToolbarButton;
  private statusLabel: HTMLElement;
  private toolbar: any;

  constructor() {
    super(true);
    this.registerRequiredCSS(playwrightLocatorStyles);
    this.contentElement.classList.add('playwright-locator-view');

    // Create toolbar container
    const toolbarElement = this.contentElement.createChild('devtools-toolbar', 'playwright-locator-toolbar');
    this.toolbar = toolbarElement;

    // Add Pick button
    this.pickButton = new UI.Toolbar.ToolbarToggle(i18nString(UIStrings.pickElement), 'select-element');
    this.pickButton.addEventListener(UI.Toolbar.ToolbarButton.Events.CLICK, () => this.togglePickMode());
    this.toolbar.appendToolbarItem(this.pickButton);


    // Add locator display
    this.locatorInput = new UI.Toolbar.ToolbarInput(
      i18nString(UIStrings.locatorWillAppearHere)
    );
    this.toolbar.appendToolbarItem(this.locatorInput);

    // Add copy button
    this.copyButton = new UI.Toolbar.ToolbarButton(i18nString(UIStrings.copyLocator), 'copy');
    this.copyButton.addEventListener(UI.Toolbar.ToolbarButton.Events.CLICK, () => this.copyLocator());
    this.copyButton.setEnabled(false);
    this.toolbar.appendToolbarItem(this.copyButton);

    // Add status label below toolbar
    this.statusLabel = this.contentElement.createChild('div', 'playwright-locator-status');
    this.statusLabel.textContent = 'Ready to pick an element';

    // Register as listener to the service
    LocatorPickerService.instance().addListener(this);
  }

  // Implement LocatorPickerListener interface
  onPickModeChanged(isActive: boolean): void {
    this.pickButton.setToggled(isActive);
    if (isActive) {
      this.statusLabel.textContent = 'Hover over an element to preview, click to select';
      this.statusLabel.classList.add('picking');
    } else {
      this.statusLabel.textContent = 'Ready to pick an element';
      this.statusLabel.classList.remove('picking');
    }
  }

  onLocatorHovered(locator: string, elementInfo: {tagName: string, id: string, className: string}): void {
    this.locatorInput.setValue(locator);
    const nodeId = elementInfo.id;
    this.statusLabel.textContent = `Hovering: ${elementInfo.tagName}${nodeId ? '#' + nodeId : ''}`;
  }

  onLocatorSelected(locator: string): void {
    this.locatorInput.setValue(locator);
    this.copyButton.setEnabled(true);
    this.statusLabel.textContent = 'Element selected';
    this.statusLabel.classList.remove('picking');
  }

  private togglePickMode(): void {
    const service = LocatorPickerService.instance();
    if (service.isInPickMode()) {
      // User is cancelling by toggling the button off
      void service.cancelPickMode();
    } else {
      void service.startPickMode();
    }
  }

  private copyLocator(): void {
    const locator = this.locatorInput.value();
    if (locator) {
      Host.InspectorFrontendHost.InspectorFrontendHostInstance.copyText(locator);
      UI.Tooltip.Tooltip.install(this.copyButton.element, i18nString(UIStrings.copiedToClipboard));

      // Clear tooltip after 2 seconds
      setTimeout(() => {
        UI.Tooltip.Tooltip.install(this.copyButton.element, i18nString(UIStrings.copyLocator));
      }, 2000);
    }
  }

  override wasShown(): void {
    super.wasShown();
    this.locatorInput.focus();
  }

  override willHide(): void {
    // Clean up when view is hidden (optional)
    super.willHide();
  }

  override detach(): void {
    // Remove listener when view is detached
    LocatorPickerService.instance().removeListener(this);
    super.detach();
  }
}