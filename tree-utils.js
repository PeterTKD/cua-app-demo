'use strict';

const interactableTypes = new Set([
  'ControlType.Button',
  'ControlType.Edit',
  'ControlType.ComboBox',
  'ControlType.ListItem',
  'ControlType.MenuItem',
  'ControlType.CheckBox',
  'ControlType.RadioButton',
  'ControlType.TabItem',
  'ControlType.Hyperlink',
  'ControlType.Slider',
  'ControlType.ScrollBar',
  'ControlType.SplitButton',
  'ControlType.List',
  'ControlType.Tree',
  'ControlType.DataGrid',
  'ControlType.DataItem',
  'ControlType.Table',
  'ControlType.MenuBar',
  'ControlType.ToolBar',
  'ControlType.Custom'
]);

function hasInteractableDescendants(element) {
  if (!element || typeof element !== 'object') return false;
  if (interactableTypes.has(element.ControlType)) return true;
  if (Array.isArray(element.Children)) {
    return element.Children.some((child) => hasInteractableDescendants(child));
  }
  return false;
}

function pruneUITree(elements) {
  if (!Array.isArray(elements)) return elements;

  return elements
    .filter((el) => {
      // Filter out elements with no width or height.
      if (!el?.BoundingRect) return false;
      if (el.BoundingRect.Width === 0 || el.BoundingRect.Height === 0) return false;

      // Empty DataItem cells are filtered earlier in the native collector.
      if (!hasInteractableDescendants(el)) return false;
      return true;
    })
    .map((el) => {
      const pruned = {
        t: el.ControlType
      };

      if (el.Name) pruned.n = el.Name;
      if (el.Value) pruned.v = el.Value;
      if (el.CellAddress) pruned.a = el.CellAddress;
      if (el.ClassName) pruned.c = el.ClassName;

      pruned.b = {
        x: el.BoundingRect.X,
        y: el.BoundingRect.Y,
        w: el.BoundingRect.Width,
        h: el.BoundingRect.Height
      };

      if (Array.isArray(el.Children) && el.Children.length > 0) {
        pruned.h = pruneUITree(el.Children);
      }

      return pruned;
    });
}

function validateAndNormalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') {
    return null;
  }

  const normalized = {
    x: bounds.x ?? bounds.X ?? 0,
    y: bounds.y ?? bounds.Y ?? 0,
    width: bounds.width ?? bounds.Width ?? bounds.w ?? 0,
    height: bounds.height ?? bounds.Height ?? bounds.h ?? 0
  };

  if (normalized.width <= 0 || normalized.height <= 0) {
    if (normalized.width <= 0) normalized.width = 100;
    if (normalized.height <= 0) normalized.height = 40;
  }

  return normalized;
}

module.exports = {
  hasInteractableDescendants,
  pruneUITree,
  validateAndNormalizeBounds
};
