/* HiDPI canvas helpers — bitmap size binding + media/bitmap coordinate scopes.
 * Inspired by TradingView fancy-canvas techniques (not a dependency).
 */
(function (global) {
  "use strict";

  function size(width, height) {
    return { width: width, height: height };
  }

  function equalSizes(a, b) {
    return a.width === b.width && a.height === b.height;
  }

  function canvasWindow(canvasElement) {
    return canvasElement.ownerDocument
      ? canvasElement.ownerDocument.defaultView
      : null;
  }

  function predictedBitmapSize(canvasRect, ratio) {
    return size(
      Math.round(canvasRect.left * ratio + canvasRect.width * ratio) -
        Math.round(canvasRect.left * ratio),
      Math.round(canvasRect.top * ratio + canvasRect.height * ratio) -
        Math.round(canvasRect.top * ratio)
    );
  }

  function isDevicePixelContentBoxSupported() {
    return new Promise(function (resolve) {
      if (typeof ResizeObserver === "undefined") {
        resolve(false);
        return;
      }
      var ro = new ResizeObserver(function (entries) {
        resolve(entries.every(function (entry) {
          return "devicePixelContentBoxSize" in entry;
        }));
        ro.disconnect();
      });
      try {
        ro.observe(document.body, { box: "device-pixel-content-box" });
      } catch (err) {
        resolve(false);
      }
    }).catch(function () {
      return false;
    });
  }

  function createDevicePixelRatioObservable(win) {
    var observers = [];
    var mediaQueryList = null;

    function notify() {
      var value = win.devicePixelRatio;
      for (var i = 0; i < observers.length; i++) {
        observers[i](value);
      }
    }

    function uninstall() {
      if (mediaQueryList == null) return;
      if (mediaQueryList.removeEventListener) {
        mediaQueryList.removeEventListener("change", onChange);
      } else if (mediaQueryList.removeListener) {
        mediaQueryList.removeListener(onChange);
      }
      mediaQueryList = null;
    }

    function install() {
      var dppx = win.devicePixelRatio;
      mediaQueryList = win.matchMedia("all and (resolution: " + dppx + "dppx)");
      if (mediaQueryList.addEventListener) {
        mediaQueryList.addEventListener("change", onChange);
      } else if (mediaQueryList.addListener) {
        mediaQueryList.addListener(onChange);
      }
    }

    function onChange() {
      notify();
      uninstall();
      install();
    }

    install();

    return {
      get value() {
        return win.devicePixelRatio;
      },
      subscribe: function (next) {
        observers.push(next);
        return {
          unsubscribe: function () {
            observers = observers.filter(function (o) {
              return o !== next;
            });
          },
        };
      },
      dispose: function () {
        uninstall();
        observers = [];
      },
    };
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {{width:number,height:number}} mediaSize  CSS pixels
   * @param {{width:number,height:number}} bitmapSize device pixels
   */
  function createRenderingTarget(context, mediaSize, bitmapSize) {
    if (mediaSize.width === 0 || mediaSize.height === 0) {
      throw new TypeError(
        "Rendering target requires positive media width and height"
      );
    }
    if (bitmapSize.width === 0 || bitmapSize.height === 0) {
      throw new TypeError(
        "Rendering target requires positive bitmap width and height"
      );
    }

    var horizontalPixelRatio = bitmapSize.width / mediaSize.width;
    var verticalPixelRatio = bitmapSize.height / mediaSize.height;

    return {
      mediaSize: mediaSize,
      bitmapSize: bitmapSize,
      horizontalPixelRatio: horizontalPixelRatio,
      verticalPixelRatio: verticalPixelRatio,
      useMediaCoordinateSpace: function (f) {
        context.save();
        try {
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.scale(horizontalPixelRatio, verticalPixelRatio);
          return f({
            context: context,
            mediaSize: mediaSize,
          });
        } finally {
          context.restore();
        }
      },
      useBitmapCoordinateSpace: function (f) {
        context.save();
        try {
          context.setTransform(1, 0, 0, 1, 0, 0);
          return f({
            context: context,
            mediaSize: mediaSize,
            bitmapSize: bitmapSize,
            horizontalPixelRatio: horizontalPixelRatio,
            verticalPixelRatio: verticalPixelRatio,
          });
        } finally {
          context.restore();
        }
      },
    };
  }

  /**
   * Observe ideal bitmap size; call applySuggestedBitmapSize() before drawing.
   * @param {HTMLCanvasElement} canvasElement
   * @param {{onSuggestedBitmapSizeChanged?: Function, allowResizeObserver?: boolean}=} options
   */
  function bindCanvasBitmapSize(canvasElement, options) {
    options = options || {};
    var allowResizeObserver = options.allowResizeObserver !== false;
    var onSuggested = options.onSuggestedBitmapSizeChanged || null;

    var clientSize = size(
      canvasElement.clientWidth,
      canvasElement.clientHeight
    );
    var suggestedBitmapSize = null;
    var devicePixelRatioObservable = null;
    var canvasElementResizeObserver = null;
    var disposed = false;

    function emitSuggested(oldSize, newSize) {
      if (onSuggested) onSuggested(oldSize, newSize);
    }

    function currentBitmapSize() {
      return size(canvasElement.width, canvasElement.height);
    }

    function resizeBitmap(newSize) {
      var oldSize = currentBitmapSize();
      if (equalSizes(oldSize, newSize)) return;
      canvasElement.width = newSize.width;
      canvasElement.height = newSize.height;
    }

    function suggestNewBitmapSize(newSize) {
      var oldSuggested = suggestedBitmapSize;
      var finalSize = size(
        Math.max(1, Math.round(newSize.width)),
        Math.max(1, Math.round(newSize.height))
      );
      var next =
        equalSizes(currentBitmapSize(), finalSize) ? null : finalSize;

      if (oldSuggested === null && next === null) return;
      if (
        oldSuggested !== null &&
        next !== null &&
        equalSizes(oldSuggested, next)
      ) {
        return;
      }

      suggestedBitmapSize = next;
      emitSuggested(oldSuggested, next);
    }

    function invalidateFromDevicePixelRatio() {
      if (disposed) return;
      var win = canvasWindow(canvasElement);
      if (win === null) return;

      var ratio =
        (devicePixelRatioObservable && devicePixelRatioObservable.value) ||
        win.devicePixelRatio ||
        1;
      var rects = canvasElement.getClientRects();
      var newSize;
      if (rects[0] !== undefined) {
        newSize = predictedBitmapSize(rects[0], ratio);
      } else {
        clientSize = size(
          canvasElement.clientWidth,
          canvasElement.clientHeight
        );
        newSize = size(
          clientSize.width * ratio,
          clientSize.height * ratio
        );
      }
      clientSize = size(
        canvasElement.clientWidth,
        canvasElement.clientHeight
      );
      suggestNewBitmapSize(newSize);
    }

    function initDevicePixelRatioObservable() {
      var win = canvasWindow(canvasElement);
      if (win === null) {
        throw new Error("No window is associated with the canvas");
      }
      devicePixelRatioObservable = createDevicePixelRatioObservable(win);
      devicePixelRatioObservable.subscribe(function () {
        invalidateFromDevicePixelRatio();
      });
      invalidateFromDevicePixelRatio();
    }

    function initResizeObserver() {
      canvasElementResizeObserver = new ResizeObserver(function (entries) {
        if (disposed) return;
        var entry = null;
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].target === canvasElement) {
            entry = entries[i];
            break;
          }
        }
        if (
          !entry ||
          !entry.devicePixelContentBoxSize ||
          !entry.devicePixelContentBoxSize[0]
        ) {
          return;
        }
        var box = entry.devicePixelContentBoxSize[0];
        clientSize = size(
          canvasElement.clientWidth,
          canvasElement.clientHeight
        );
        suggestNewBitmapSize(
          size(box.inlineSize, box.blockSize)
        );
      });
      canvasElementResizeObserver.observe(canvasElement, {
        box: "device-pixel-content-box",
      });
    }

    function chooseAndInitObserver() {
      if (!allowResizeObserver || typeof ResizeObserver === "undefined") {
        initDevicePixelRatioObservable();
        return;
      }
      isDevicePixelContentBoxSupported().then(function (supported) {
        if (disposed) return;
        if (supported) initResizeObserver();
        else initDevicePixelRatioObservable();
      });
    }

    chooseAndInitObserver();

    return {
      get canvasElement() {
        return canvasElement;
      },
      get canvasElementClientSize() {
        return clientSize;
      },
      get bitmapSize() {
        return currentBitmapSize();
      },
      get suggestedBitmapSize() {
        return suggestedBitmapSize;
      },
      applySuggestedBitmapSize: function () {
        if (suggestedBitmapSize === null) return;
        var toApply = suggestedBitmapSize;
        suggestedBitmapSize = null;
        resizeBitmap(toApply);
        emitSuggested(toApply, null);
      },
      syncClientSize: function () {
        clientSize = size(
          Math.max(1, canvasElement.clientWidth),
          Math.max(1, canvasElement.clientHeight)
        );
        return clientSize;
      },
      dispose: function () {
        if (disposed) return;
        disposed = true;
        if (canvasElementResizeObserver) {
          canvasElementResizeObserver.disconnect();
          canvasElementResizeObserver = null;
        }
        if (devicePixelRatioObservable) {
          devicePixelRatioObservable.dispose();
          devicePixelRatioObservable = null;
        }
        suggestedBitmapSize = null;
        onSuggested = null;
      },
    };
  }

  global.HidpiCanvas = {
    bindCanvasBitmapSize: bindCanvasBitmapSize,
    createRenderingTarget: createRenderingTarget,
  };
})(typeof window !== "undefined" ? window : this);
