const edge = require('electron-edge-js');

class UIAutomationDetector {
  constructor() {
    this.isWindows = process.platform === 'win32';
    this.initializeEdgeFunctions();
  }

  // Helper to promisify edge functions
  promisify(edgeFunc) {
    return (input) => {
      return new Promise((resolve, reject) => {
        edgeFunc(input, (error, result) => {
          if (error) reject(error);
          else resolve(result);
        });
      });
    };
  }

  initializeEdgeFunctions() {
    if (!this.isWindows) return;

    // Get element at point
    this.getElementAtPointFunc = edge.func(`
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\UIAutomationClient\\v4.0_4.0.0.0__31bf3856ad364e35\\UIAutomationClient.dll"
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\UIAutomationTypes\\v4.0_4.0.0.0__31bf3856ad364e35\\UIAutomationTypes.dll"
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\WindowsBase\\v4.0_4.0.0.0__31bf3856ad364e35\\WindowsBase.dll"
      
      using System;
      using System.Threading.Tasks;
      using System.Windows.Automation;
      using System.Collections.Generic;
      
      public class Startup {
        public async Task<object> Invoke(object input) {
          var point = (IDictionary<string, object>)input;
          double x = Convert.ToDouble(point["x"]);
          double y = Convert.ToDouble(point["y"]);
          
          try {
            var element = AutomationElement.FromPoint(new System.Windows.Point(x, y));
            if (element == null) return null;
            
            var result = new Dictionary<string, object>();
            result["Name"] = element.Current.Name;
            result["ClassName"] = element.Current.ClassName;
            result["ControlType"] = element.Current.ControlType.ProgrammaticName;
            result["AutomationId"] = element.Current.AutomationId;
            result["ProcessId"] = element.Current.ProcessId;
            result["IsOffscreen"] = element.Current.IsOffscreen;
            
            var rect = element.Current.BoundingRectangle;
            var boundingRect = new Dictionary<string, object>();
            boundingRect["X"] = (int)rect.X;
            boundingRect["Y"] = (int)rect.Y;
            boundingRect["Width"] = (int)rect.Width;
            boundingRect["Height"] = (int)rect.Height;
            result["BoundingRect"] = boundingRect;
            
            try {
              var parent = TreeWalker.ControlViewWalker.GetParent(element);
              if (parent != null) {
                result["ParentName"] = parent.Current.Name;
              }
            } catch { }
            
            try {
              var process = System.Diagnostics.Process.GetProcessById(element.Current.ProcessId);
              result["ProcessName"] = process.ProcessName;
              result["ProcessPath"] = process.MainModule != null ? process.MainModule.FileName : null;
            } catch { }
            
            return result;
          } catch (Exception ex) {
            throw new Exception("Error getting element: " + ex.Message);
          }
        }
      }
    `);

    // Get focused element
    this.getFocusedElementFunc = edge.func(`
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\UIAutomationClient\\v4.0_4.0.0.0__31bf3856ad364e35\\UIAutomationClient.dll"
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\UIAutomationTypes\\v4.0_4.0.0.0__31bf3856ad364e35\\UIAutomationTypes.dll"
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\WindowsBase\\v4.0_4.0.0.0__31bf3856ad364e35\\WindowsBase.dll"
      
      using System;
      using System.Threading.Tasks;
      using System.Windows.Automation;
      using System.Collections.Generic;
      
      public class Startup {
        public async Task<object> Invoke(object input) {
          try {
            var element = AutomationElement.FocusedElement;
            if (element == null) return null;
            
            var result = new Dictionary<string, object>();
            result["Name"] = element.Current.Name;
            result["ClassName"] = element.Current.ClassName;
            result["ControlType"] = element.Current.ControlType.ProgrammaticName;
            result["AutomationId"] = element.Current.AutomationId;
            result["ProcessId"] = element.Current.ProcessId;
            result["IsOffscreen"] = element.Current.IsOffscreen;
            
            var rect = element.Current.BoundingRectangle;
            var boundingRect = new Dictionary<string, object>();
            boundingRect["X"] = (int)rect.X;
            boundingRect["Y"] = (int)rect.Y;
            boundingRect["Width"] = (int)rect.Width;
            boundingRect["Height"] = (int)rect.Height;
            result["BoundingRect"] = boundingRect;
            
            try {
              var process = System.Diagnostics.Process.GetProcessById(element.Current.ProcessId);
              result["ProcessName"] = process.ProcessName;
              result["ProcessPath"] = process.MainModule != null ? process.MainModule.FileName : null;
            } catch { }
            
            return result;
          } catch (Exception ex) {
            throw new Exception("Error getting focused element: " + ex.Message);
          }
        }
      }
    `);

    // Get foreground window
    this.getForegroundWindowFunc = edge.func(`
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\UIAutomationClient\\v4.0_4.0.0.0__31bf3856ad364e35\\UIAutomationClient.dll"
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\UIAutomationTypes\\v4.0_4.0.0.0__31bf3856ad364e35\\UIAutomationTypes.dll"
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\WindowsBase\\v4.0_4.0.0.0__31bf3856ad364e35\\WindowsBase.dll"
      
      using System;
      using System.Threading.Tasks;
      using System.Windows.Automation;
      using System.Collections.Generic;
      using System.Runtime.InteropServices;
      using System.Text;
      using System.Linq;
      
      public class User32 {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        
        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        
        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);
        
        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);
        
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        
        [DllImport("user32.dll")]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
        
        [DllImport("user32.dll")]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
        
        [DllImport("user32.dll")]
        public static extern long GetWindowLongPtr(IntPtr hWnd, int nIndex);
        
        [DllImport("user32.dll")]
        public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
        
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindow(IntPtr hWnd);
        
        public const int GWL_EXSTYLE = -20;
        public const long WS_EX_TOOLWINDOW = 0x00000080L;
        public const long WS_EX_TOPMOST = 0x00000008L;
        public const long WS_EX_NOACTIVATE = 0x08000000L;
        public const uint GA_ROOT = 2;
      }
      
      public class Startup {
        public async Task<object> Invoke(object input) {
          try {
            // Parse input
            int? displayX = null;
            int? displayY = null;
            int? displayWidth = null;
            int? displayHeight = null;
            int? appPid = null;
            
            if (input != null && input is IDictionary<string, object>) {
              var inputDict = (IDictionary<string, object>)input;
              
              // Parse appPid if provided
              if (inputDict.ContainsKey("appPid") && inputDict["appPid"] != null) {
                appPid = Convert.ToInt32(inputDict["appPid"]);
              }
              
              // Parse display bounds if provided
              if (inputDict.ContainsKey("displayBounds") && inputDict["displayBounds"] != null) {
                var bounds = (IDictionary<string, object>)inputDict["displayBounds"];
                if (bounds.ContainsKey("x")) displayX = Convert.ToInt32(bounds["x"]);
                if (bounds.ContainsKey("y")) displayY = Convert.ToInt32(bounds["y"]);
                if (bounds.ContainsKey("width")) displayWidth = Convert.ToInt32(bounds["width"]);
                if (bounds.ContainsKey("height")) displayHeight = Convert.ToInt32(bounds["height"]);
              }
            }
            
            bool hasDisplayFilter = displayX.HasValue && displayY.HasValue && displayWidth.HasValue && displayHeight.HasValue;
            
            // OPTIMIZATION: Use the current app PID instead of scanning all processes
            var electronProcessIds = new HashSet<int>();
            if (appPid.HasValue) {
              electronProcessIds.Add(appPid.Value);
            } else {
              // Fallback: scan all processes (slow path)
              var allProcesses = System.Diagnostics.Process.GetProcesses();
              foreach (var proc in allProcesses) {
                try {
                  var processName = proc.ProcessName.ToLower();
                  if (processName.Contains("electron")) {
                    electronProcessIds.Add(proc.Id);
                  }
                } catch { }
              }
            }
            
            // Helper function to check if window is on the display
            Func<IntPtr, bool> isOnDisplay = (hwnd) => {
              if (!hasDisplayFilter) return true;
              
              try {
                var elem = AutomationElement.FromHandle(hwnd);
                if (elem == null) return false;
                
                var windowRect = elem.Current.BoundingRectangle;
                if (double.IsInfinity(windowRect.X) || double.IsNaN(windowRect.X)) return false;
                
                // Check if window center is within display bounds
                double windowCenterX = windowRect.X + windowRect.Width / 2;
                double windowCenterY = windowRect.Y + windowRect.Height / 2;

                Console.WriteLine("Checking window (HWND: " + hwnd + ") against display filter...");
                Console.WriteLine("Window rect: X=" + windowRect.X + ", Y=" + windowRect.Y + ", Width=" + windowRect.Width + ", Height=" + windowRect.Height);

                Console.WriteLine("displayX: " + displayX.Value + ", displayY: " + displayY.Value + ", displayWidth: " + displayWidth.Value + ", displayHeight: " + displayHeight.Value);
                Console.WriteLine("Window center: (" + windowCenterX + ", " + windowCenterY + ")");
                
                return windowCenterX >= displayX.Value &&
                       windowCenterX < displayX.Value + displayWidth.Value &&
                       windowCenterY >= displayY.Value &&
                       windowCenterY < displayY.Value + displayHeight.Value;
              } catch {
                return false;
              }
            };
            
            IntPtr targetHwnd = IntPtr.Zero;
            uint targetPid = 0;
            string targetTitle = "";
            
            Console.WriteLine("[GetForegroundWindow] Display filter: " + (hasDisplayFilter ? displayX + "," + displayY + " " + displayWidth + "x" + displayHeight : "none"));
            
            // Strategy 1: Try GetForegroundWindow first (best when user is actively using the shared screen)
            IntPtr foregroundHwnd = User32.GetForegroundWindow();
            
            if (foregroundHwnd != IntPtr.Zero && User32.IsWindow(foregroundHwnd)) {
              // Get root window (in case we got a child window)
              IntPtr rootHwnd = User32.GetAncestor(foregroundHwnd, User32.GA_ROOT);
              if (rootHwnd != IntPtr.Zero) {
                foregroundHwnd = rootHwnd;
              }
              
              // Check if this window is valid
              if (User32.IsWindowVisible(foregroundHwnd) && !User32.IsIconic(foregroundHwnd)) {
                long exStyle = User32.GetWindowLongPtr(foregroundHwnd, User32.GWL_EXSTYLE);
                if ((exStyle & User32.WS_EX_TOOLWINDOW) != 0) {
                  Console.WriteLine("[Strategy1] reject: WS_EX_TOOLWINDOW style");
                } else {
                  uint fgPid = 0;
                  User32.GetWindowThreadProcessId(foregroundHwnd, out fgPid);
                  
                  var titleBuilder = new StringBuilder(256);
                  User32.GetWindowText(foregroundHwnd, titleBuilder, 256);
                  var title = titleBuilder.ToString();
                  
                  var classBuilder = new StringBuilder(256);
                  User32.GetClassName(foregroundHwnd, classBuilder, 256);
                  var className = classBuilder.ToString();
                  
                  Console.WriteLine("[Strategy1] Foreground window: '" + title + "' (PID: " + fgPid + ", Class: " + className + ")");

                  // Skip shell proxy/thumbnail window classes
                  bool isShellProxy1 = className == "Windows.Internal.Shell.TabProxyWindow" ||
                                       className == "Windows.UI.Core.CoreWindow" ||
                                       className == "Shell_TrayWnd" ||
                                       className == "NotifyIconOverflowWindow" ||
                                       className == "ApplicationManager_ImmersiveShellWindow" ||
                                       className == "Progman" ||
                                       className == "WorkerW";

                  // Check if title contains this app's window patterns
                  var titleLower = title.ToLower();
                  bool isAppTitle = titleLower.Contains("screen assist widget") ||
                                   titleLower.Contains("screen picker") ||
                                   titleLower.Contains("cua history") ||
                                   titleLower.Contains("callout");

                  // Reject this app's windows
                  if (isShellProxy1) {
                    Console.WriteLine("[Strategy1] reject: shell proxy window class");
                  } else if (electronProcessIds.Contains((int)fgPid)) {
                    Console.WriteLine("[Strategy1] reject: Electron app process");
                  } else if (isAppTitle) {
                    Console.WriteLine("[Strategy1] reject: app title pattern");
                  } else {
                    // Check if window is on the shared display (mandatory when filter is set)
                    if (hasDisplayFilter && !isOnDisplay(foregroundHwnd)) {
                      Console.WriteLine("[Strategy1] reject: not on shared display");
                    } else {
                      // Validate it has a title
                      if (!string.IsNullOrWhiteSpace(title)) {
                        Console.WriteLine("[Strategy1] using foreground window on shared display");
                        targetHwnd = foregroundHwnd;
                        targetPid = fgPid;
                        targetTitle = title;
                      } else {
                        Console.WriteLine("[Strategy1] reject: no title");
                      }
                    }
                  }
                }
              }
            }
            
            // Strategy 2: Enumerate windows in Z-order (top to bottom) to find topmost valid window on shared display
            if (targetHwnd == IntPtr.Zero) {
              Console.WriteLine("[Strategy2] Enumerating windows in Z-order (topmost first)...");
              int windowCount = 0;
              
              User32.EnumWindows((hwnd, lParam) => {
                windowCount++;

                Console.WriteLine();
                
                // Basic visibility checks
                if (!User32.IsWindowVisible(hwnd)) return true;
                if (User32.IsIconic(hwnd)) return true;
                
                long exStyle = User32.GetWindowLongPtr(hwnd, User32.GWL_EXSTYLE);
                if ((exStyle & User32.WS_EX_TOOLWINDOW) != 0) return true;
                if ((exStyle & User32.WS_EX_TOPMOST) != 0) return true; // skip always-on-top system windows

                var titleBuilder = new StringBuilder(256);
                User32.GetWindowText(hwnd, titleBuilder, 256);
                var title = titleBuilder.ToString();
                
                var classBuilder = new StringBuilder(256);
                User32.GetClassName(hwnd, classBuilder, 256);
                var className = classBuilder.ToString();
                
                if (string.IsNullOrWhiteSpace(title)) {
                  return true;
                }
                
                uint processId = 0;
                User32.GetWindowThreadProcessId(hwnd, out processId);
                
                Console.WriteLine("[Strategy2] Window #" + windowCount + ": '" + title + "' (PID: " + processId + ", Class: " + className + ")");

                // Skip shell proxy/thumbnail window classes — these are not real app windows
                bool isShellProxy = className == "Windows.Internal.Shell.TabProxyWindow" ||
                                    className == "Windows.UI.Core.CoreWindow" ||
                                    className == "Shell_TrayWnd" ||
                                    className == "NotifyIconOverflowWindow" ||
                                    className == "ApplicationManager_ImmersiveShellWindow" ||
                                    className == "Progman" ||
                                    className == "WorkerW";
                if (isShellProxy) {
                  Console.WriteLine("[Strategy2] reject: shell proxy window class");
                  return true;
                }

                // Check title for this app's window patterns
                var titleLower = title.ToLower();
                bool isAppTitle = titleLower.Contains("screen assist widget") ||
                                 titleLower.Contains("screen picker") ||
                                 titleLower.Contains("cua history") ||
                                 titleLower.Contains("callout");

                if (electronProcessIds.Contains((int)processId)) {
                  Console.WriteLine("[Strategy2] reject: Electron app process");
                  return true;
                }

                if (isAppTitle) {
                  Console.WriteLine("[Strategy2] reject: app title pattern");
                  return true;
                }

                Console.WriteLine("[Strategy2]   Has display filter: " + hasDisplayFilter);
                
                // CRITICAL: If display filter is set, window MUST be on that display
                if (hasDisplayFilter && !isOnDisplay(hwnd)) {
                  Console.WriteLine("[Strategy2] reject: not on shared display");
                  return true;
                }
                
                // Found the topmost valid non-app window on the display
                Console.WriteLine("[Strategy2] using this window (topmost on shared display)");
                targetHwnd = hwnd;
                targetPid = processId;
                targetTitle = title;
                return false; // Stop enumeration
              }, IntPtr.Zero);
              
              Console.WriteLine("[Strategy2] Enumerated " + windowCount + " windows total");
            }
            
            if (targetHwnd == IntPtr.Zero) {
              Console.WriteLine("[GetForegroundWindow] No valid window found" + (hasDisplayFilter ? " on shared display" : ""));
              return null;
            }
            
            Console.WriteLine("[GetForegroundWindow] Final selection: '" + targetTitle + "' (PID: " + targetPid + ")");
            
            // Get the automation element from the window handle
            var element = AutomationElement.FromHandle(targetHwnd);
            if (element == null) return null;
            
            var result = new Dictionary<string, object>();
            result["Name"] = element.Current.Name ?? "";
            result["ClassName"] = element.Current.ClassName ?? "";
            result["ControlType"] = element.Current.ControlType.ProgrammaticName;
            result["AutomationId"] = element.Current.AutomationId ?? "";
            result["ProcessId"] = (int)targetPid;
            result["IsOffscreen"] = element.Current.IsOffscreen;
            
            var rect = element.Current.BoundingRectangle;
            int rectX = double.IsInfinity(rect.X) || double.IsNaN(rect.X) ? 0 : (int)rect.X;
            int rectY = double.IsInfinity(rect.Y) || double.IsNaN(rect.Y) ? 0 : (int)rect.Y;
            int rectWidth = double.IsInfinity(rect.Width) || double.IsNaN(rect.Width) ? 0 : (int)rect.Width;
            int rectHeight = double.IsInfinity(rect.Height) || double.IsNaN(rect.Height) ? 0 : (int)rect.Height;
            
            var boundingRect = new Dictionary<string, object>();
            boundingRect["X"] = rectX;
            boundingRect["Y"] = rectY;
            boundingRect["Width"] = rectWidth;
            boundingRect["Height"] = rectHeight;
            result["BoundingRect"] = boundingRect;
            
            try {
              var process = System.Diagnostics.Process.GetProcessById((int)targetPid);
              result["ProcessName"] = process.ProcessName;
              result["ProcessPath"] = process.MainModule != null ? process.MainModule.FileName : null;
            } catch { }
            
            return result;
          } catch (Exception ex) {
            throw new Exception("Error getting foreground window: " + ex.Message);
          }
        }
      }
    `);

    // Get window elements (UI tree) - Optimized version with CacheRequest
    this.getWindowElementsFunc = edge.func(`
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\UIAutomationClient\\v4.0_4.0.0.0__31bf3856ad364e35\\UIAutomationClient.dll"
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\UIAutomationTypes\\v4.0_4.0.0.0__31bf3856ad364e35\\UIAutomationTypes.dll"
      #r "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL\\WindowsBase\\v4.0_4.0.0.0__31bf3856ad364e35\\WindowsBase.dll"
      
      using System;
      using System.Threading.Tasks;
      using System.Windows.Automation;
      using System.Collections.Generic;
      using System.Linq;
      using System.Runtime.InteropServices;
      
      public class User32GetForeground {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        
        [DllImport("user32.dll")]
        public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
        
        public const uint GA_ROOT = 2;
      }
      
      public class Startup {
        private static readonly TreeWalker walker = TreeWalker.ControlViewWalker;

        // Phase 1 Optimizations: Configuration
        private const int MAX_TREE_DEPTH = 18;  // Depth limit for tree traversal (increased for web apps)
        private const int CACHE_TTL_SECONDS = 2;  // Cache time-to-live

        // Phase 1 Optimizations: Caching
        private static Dictionary<string, CachedTree> treeCache = new Dictionary<string, CachedTree>();

        // Lazily created on first use (after UIA COM is active) — null init is safe at class load time.
        // Batch-fetches all element properties in one COM call per FindAll level instead of N×8 calls.
        private static CacheRequest _elemCacheReq = null;

        // Statistics tracking
        private int totalElementsProcessed = 0;
        private int totalElementsSkipped = 0;

        private class CachedTree {
          public Dictionary<string, object> Tree;
          public DateTime Timestamp;
        }
        
        public async Task<object> Invoke(object input) {
          var inputDict = input as IDictionary<string, object>;
          int processId = Convert.ToInt32(inputDict["processId"]);
          
          // Parse display bounds if provided
          int? displayX = null;
          int? displayY = null;
          int? displayWidth = null;
          int? displayHeight = null;
          
          if (inputDict.ContainsKey("displayBounds")) {
            var bounds = inputDict["displayBounds"] as IDictionary<string, object>;
            if (bounds != null) {
              if (bounds.ContainsKey("x")) displayX = Convert.ToInt32(bounds["x"]);
              if (bounds.ContainsKey("y")) displayY = Convert.ToInt32(bounds["y"]);
              if (bounds.ContainsKey("width")) displayWidth = Convert.ToInt32(bounds["width"]);
              if (bounds.ContainsKey("height")) displayHeight = Convert.ToInt32(bounds["height"]);
            }
          }
          
          bool hasDisplayFilter = displayX.HasValue && displayY.HasValue && displayWidth.HasValue && displayHeight.HasValue;
          
          try {
            var condition = new PropertyCondition(AutomationElement.ProcessIdProperty, processId);
            var root = AutomationElement.RootElement;
            var allWindows = root.FindAll(TreeScope.Children, condition);
            
            if (allWindows.Count == 0) return new List<object>();
            
            // Filter to only visible, non-minimized windows with reasonable size
            var visibleWindows = new List<AutomationElement>();
            for (int i = 0; i < allWindows.Count; i++) {
              AutomationElement window = allWindows[i];
              try {
                var rect = window.Current.BoundingRectangle;
                bool isOffscreen = window.Current.IsOffscreen;
                var name = window.Current.Name ?? "";
                
                
                // Skip if offscreen or has invalid bounds
                if (isOffscreen || double.IsInfinity(rect.Width) || rect.Width < 100 || rect.Height < 100) {
                  continue;
                }
                
                // Check if window is on the shared display
                if (hasDisplayFilter) {
                  double windowCenterX = rect.X + rect.Width / 2;
                  double windowCenterY = rect.Y + rect.Height / 2;
                  
                  bool isOnDisplay = windowCenterX >= displayX.Value &&
                                    windowCenterX < displayX.Value + displayWidth.Value &&
                                    windowCenterY >= displayY.Value &&
                                    windowCenterY < displayY.Value + displayHeight.Value;
                  
                  if (!isOnDisplay) {
                    continue;
                  }
                  
                }
                
                visibleWindows.Add(window);
              } catch (Exception ex) {
              }
            }
            
            if (visibleWindows.Count == 0) {
              // No visible windows found on the specified display
              return new List<object>();
            }
            
            // Get the actual foreground window handle
            IntPtr foregroundHwnd = User32GetForeground.GetForegroundWindow();
            if (foregroundHwnd != IntPtr.Zero) {
              IntPtr rootHwnd = User32GetForeground.GetAncestor(foregroundHwnd, User32GetForeground.GA_ROOT);
              if (rootHwnd != IntPtr.Zero) {
                foregroundHwnd = rootHwnd;
              }
            }
            
            // Find the window that matches the foreground window
            AutomationElement selectedWindow = null;
            for (int i = 0; i < visibleWindows.Count; i++) {
              try {
                var hwnd = new IntPtr(visibleWindows[i].Current.NativeWindowHandle);
                var name = visibleWindows[i].Current.Name ?? "";
                
                if (hwnd == foregroundHwnd) {
                  selectedWindow = visibleWindows[i];
                  break;
                }
              } catch (Exception ex) {
              }
            }
            
            // If no match, use the first visible window (we already checked count > 0 above)
            if (selectedWindow == null) {
              selectedWindow = visibleWindows[0];
            }

            // Pass display offset for coordinate normalization (if display filter is active)
            var windowResult = ProcessWindow(selectedWindow, displayX, displayY);

            if (windowResult == null) {
              return new List<object>();
            }

            if (hasDisplayFilter) {
            }

            return new List<object> { windowResult };
          } catch (Exception ex) {
            throw new Exception("Error getting window elements: " + ex.Message);
          }
        }
        
        // Phase 1 Optimization: Smart element pruning
        private bool ShouldSkipElement(AutomationElement element) {
          try {
            var controlType = element.Current.ControlType;

            // Excel uses a virtual grid: DataItem cells are marked IsOffscreen even when visible.
            // Skip the IsOffscreen check for DataItem so spreadsheet cells are included.
            bool isDataItem = controlType == ControlType.DataItem;

            // For DataItem (spreadsheet cells), skip empty cells to reduce tree size
            // This significantly reduces token usage for spreadsheet applications
            if (isDataItem) {
              try {
                // Try to get the cell value
                object valuePattern;
                if (element.TryGetCurrentPattern(ValuePattern.Pattern, out valuePattern)) {
                  var val = ((ValuePattern)valuePattern).Current.Value;
                  // Skip if empty or whitespace only
                  if (string.IsNullOrWhiteSpace(val)) {
                    return true;
                  }
                } else {
                  // No value pattern and no name means empty cell
                  var name = element.Current.Name ?? "";
                  if (string.IsNullOrWhiteSpace(name)) {
                    return true;
                  }
                }
              } catch {
                // If we can't read the value, skip it
                return true;
              }
            }

            // Skip offscreen elements (except DataItem which Excel incorrectly marks as offscreen)
            if (!isDataItem && element.Current.IsOffscreen) {
              return true;
            }

            // Skip zero-sized or invalid elements
            var rect = element.Current.BoundingRectangle;
            if (double.IsInfinity(rect.Width) || double.IsNaN(rect.Width) ||
                rect.Width <= 0 || rect.Height <= 0) {
              return true;
            }

            // Skip only truly decorative elements (not MenuBar/ToolBar as they contain important UI)
            if (controlType == ControlType.ScrollBar ||
                controlType == ControlType.Separator ||
                controlType == ControlType.TitleBar) {
              return true;
            }

            return false;
          } catch {
            return true; // Skip if we can't access properties
          }
        }

        private Dictionary<string, object> ProcessWindow(AutomationElement window, int? displayX, int? displayY) {
          try {
            var startTime = DateTime.Now;

            // Phase 1 Optimization: Check cache first
            string cacheKey = window.Current.NativeWindowHandle.ToString() + "_" +
                            (displayX.HasValue ? displayX.Value.ToString() : "null") + "_" +
                            (displayY.HasValue ? displayY.Value.ToString() : "null");

            if (treeCache.ContainsKey(cacheKey)) {
              var cached = treeCache[cacheKey];
              var age = (DateTime.Now - cached.Timestamp).TotalSeconds;

              if (age < CACHE_TTL_SECONDS) {
                Console.WriteLine("[ProcessWindow] Using cached tree (age: " + age.ToString("F2") + "s)");
                return cached.Tree;
              } else {
                Console.WriteLine("[ProcessWindow] Cache expired (age: " + age.ToString("F2") + "s), re-parsing");
                treeCache.Remove(cacheKey);
              }
            }

            Console.WriteLine("[ProcessWindow] Starting tree traversal with optimizations (max depth: " + MAX_TREE_DEPTH + ")");

            // Reset statistics
            totalElementsProcessed = 0;
            totalElementsSkipped = 0;

            // Recursive traversal with depth limiting and smart pruning
            var result = BuildElementTreeRecursive(window, displayX, displayY, 0);

            var elapsed = (DateTime.Now - startTime).TotalMilliseconds;
            Console.WriteLine("[ProcessWindow] Completed in " + elapsed + "ms");

            // Calculate and display pruning statistics
            int totalElements = totalElementsProcessed + totalElementsSkipped;
            double prunedPercent = totalElements > 0 ? (totalElementsSkipped * 100.0) / totalElements : 0;
            Console.WriteLine("[ProcessWindow] Elements processed: " + totalElementsProcessed + ", skipped: " + totalElementsSkipped +
                            " (pruned " + prunedPercent.ToString("F1") + "%)");

            // Phase 1 Optimization: Cache the result
            treeCache[cacheKey] = new CachedTree { Tree = result, Timestamp = DateTime.Now };
            Console.WriteLine("[ProcessWindow] Tree cached for future use");

            return result;
          } catch (Exception ex) {
            Console.WriteLine("[ProcessWindow] ERROR: " + ex.Message);
            Console.WriteLine("[ProcessWindow] Stack: " + ex.StackTrace);
            return null;
          }
        }

        private Dictionary<string, object> BuildElementTreeRecursive(AutomationElement element, int? displayX, int? displayY, int currentDepth) {
          try {
            // Phase 1 Optimization: Depth limiting
            if (currentDepth >= MAX_TREE_DEPTH) {
              // Return leaf element without children when max depth reached
              return CreateElementData(element, new List<object>(), displayX, displayY);
            }

            var children = new List<object>();

            // Lazy-init the CacheRequest on first call (UIA is guaranteed active here).
            // This is safe: the field is null until the first traversal runs.
            if (_elemCacheReq == null) {
              try {
                var cr = new CacheRequest();
                cr.Add(AutomationElement.ControlTypeProperty);
                cr.Add(AutomationElement.NameProperty);
                cr.Add(AutomationElement.ClassNameProperty);
                cr.Add(AutomationElement.AutomationIdProperty);
                cr.Add(AutomationElement.IsOffscreenProperty);
                cr.Add(AutomationElement.BoundingRectangleProperty);
                cr.Add(ValuePattern.Pattern);
                cr.Add(ValuePattern.ValueProperty);
                cr.TreeScope = TreeScope.Element;
                _elemCacheReq = cr;
              } catch {
                _elemCacheReq = null; // stays null — FindAll fallback below handles this
              }
            }

            // Get all immediate children in ONE batch call.
            // With an active CacheRequest, all declared properties are pre-fetched for
            // every returned element in that single call — no per-property COM round-trips.
            AutomationElementCollection childElements = null;
            try {
              if (_elemCacheReq != null) {
                using (_elemCacheReq.Activate()) {
                  childElements = element.FindAll(TreeScope.Children, Condition.TrueCondition);
                }
              } else {
                childElements = element.FindAll(TreeScope.Children, Condition.TrueCondition);
              }
            } catch {
              try { childElements = element.FindAll(TreeScope.Children, Condition.TrueCondition); } catch { }
            }

            if (childElements != null && childElements.Count > 0) {
              for (int i = 0; i < childElements.Count; i++) {
                try {
                  var child = childElements[i];

                  // Phase 1 Optimization: Smart pruning
                  if (ShouldSkipElement(child)) {
                    totalElementsSkipped++;
                    continue; // Skip this element
                  }

                  totalElementsProcessed++;

                  // Recursively build child tree with display offset and incremented depth
                  var childData = BuildElementTreeRecursive(child, displayX, displayY, currentDepth + 1);
                  if (childData != null) {
                    children.Add(childData);
                  }
                } catch {
                  totalElementsSkipped++;
                }
              }
            }

            // Use Current properties and apply display offset if provided
            return CreateElementData(element, children, displayX, displayY);
          } catch {
            return null;
          }
        }

        private Dictionary<string, object> CreateElementData(AutomationElement element, List<object> children, int? displayX, int? displayY) {
          // Use cached properties when available (populated by FindAll with active CacheRequest).
          // Fall back to live .Current.* COM calls for the window root or if cache is unpopulated.
          bool useCached = false;
          ControlType controlType;
          System.Windows.Rect rect;
          string nameStr, classNameStr, automationIdStr;
          bool isOffscreenVal;
          try {
            controlType     = element.Cached.ControlType;
            rect            = element.Cached.BoundingRectangle;
            nameStr         = element.Cached.Name ?? "";
            classNameStr    = element.Cached.ClassName ?? "";
            automationIdStr = element.Cached.AutomationId ?? "";
            isOffscreenVal  = element.Cached.IsOffscreen;
            useCached = true;
          } catch {
            controlType     = element.Current.ControlType;
            rect            = element.Current.BoundingRectangle;
            nameStr         = element.Current.Name ?? "";
            classNameStr    = element.Current.ClassName ?? "";
            automationIdStr = element.Current.AutomationId ?? "";
            isOffscreenVal  = element.Current.IsOffscreen;
          }

          int rectX = double.IsInfinity(rect.X) || double.IsNaN(rect.X) ? 0 : (int)rect.X;
          int rectY = double.IsInfinity(rect.Y) || double.IsNaN(rect.Y) ? 0 : (int)rect.Y;
          int rectWidth = double.IsInfinity(rect.Width) || double.IsNaN(rect.Width) ? 0 : (int)rect.Width;
          int rectHeight = double.IsInfinity(rect.Height) || double.IsNaN(rect.Height) ? 0 : (int)rect.Height;

          // Transform to display-relative coordinates if display offset is provided
          if (displayX.HasValue && displayY.HasValue) {
            rectX -= displayX.Value;
            rectY -= displayY.Value;
          }

          var elementData = new Dictionary<string, object>();
          elementData["Name"] = nameStr;
          elementData["ClassName"] = classNameStr;
          elementData["ControlType"] = controlType.ProgrammaticName;
          elementData["AutomationId"] = automationIdStr;
          elementData["IsOffscreen"] = isOffscreenVal;

          // Read element value — prefer cached, fall back to live
          try {
            object vp;
            bool hasPattern = useCached
              ? element.TryGetCachedPattern(ValuePattern.Pattern, out vp)
              : element.TryGetCurrentPattern(ValuePattern.Pattern, out vp);
            if (hasPattern) {
              var val = useCached ? ((ValuePattern)vp).Cached.Value : ((ValuePattern)vp).Current.Value;
              if (!string.IsNullOrEmpty(val)) {
                elementData["Value"] = val;
              }
            }
          } catch { }

          // For DataItem (spreadsheet cells), AutomationId holds the cell address (e.g. "A1")
          if (controlType == ControlType.DataItem) {
            if (!string.IsNullOrEmpty(automationIdStr)) {
              elementData["CellAddress"] = automationIdStr;
            }
            // Debug: log first few cells so we can see what UIA exposes
            if (totalElementsProcessed <= 5) {
              Console.WriteLine("[DataItem] addr=" + automationIdStr +
                " name='" + nameStr + "'" +
                " useCached=" + useCached +
                " value='" + (elementData.ContainsKey("Value") ? elementData["Value"] : "") + "'");
            }
          }

          var boundingRect = new Dictionary<string, object>();
          boundingRect["X"] = rectX;
          boundingRect["Y"] = rectY;
          boundingRect["Width"] = rectWidth;
          boundingRect["Height"] = rectHeight;
          elementData["BoundingRect"] = boundingRect;

          if (children.Count > 0) {
            elementData["Children"] = children;
          }

          return elementData;
        }
      }
    `);

    // Native screen capture using GDI+
    this.captureScreenNativeFunc = edge.func(`
      #r "System.Drawing.dll"
      
      using System;
      using System.Threading.Tasks;
      using System.Drawing;
      using System.Drawing.Imaging;
      using System.IO;
      using System.Collections.Generic;
      
      public class Startup {
        public async Task<object> Invoke(object input) {
          var inputDict = input as IDictionary<string, object>;
          int x = Convert.ToInt32(inputDict["x"]);
          int y = Convert.ToInt32(inputDict["y"]);
          int width = Convert.ToInt32(inputDict["width"]);
          int height = Convert.ToInt32(inputDict["height"]);
          int quality = inputDict.ContainsKey("quality") ? Convert.ToInt32(inputDict["quality"]) : 85;
          
          try {
            // Create bitmap and capture screen region
            using (var bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
              using (var graphics = Graphics.FromImage(bitmap)) {
                // Use high-quality, fast settings
                graphics.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighSpeed;
                graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Low;
                graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighSpeed;
                
                // Capture from screen
                graphics.CopyFromScreen(x, y, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
              }
              
              // Encode to JPEG with specified quality
              var encoderParameters = new EncoderParameters(1);
              encoderParameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
              var jpegCodec = GetEncoder(ImageFormat.Jpeg);
              
              using (var ms = new MemoryStream()) {
                bitmap.Save(ms, jpegCodec, encoderParameters);
                return Convert.ToBase64String(ms.ToArray());
              }
            }
          } catch (Exception ex) {
            throw new Exception("Native screen capture error: " + ex.Message);
          }
        }
        
        private static ImageCodecInfo GetEncoder(ImageFormat format) {
          var codecs = ImageCodecInfo.GetImageDecoders();
          foreach (var codec in codecs) {
            if (codec.FormatID == format.Guid) {
              return codec;
            }
          }
          return null;
        }
      }
    `);

    this.setWindowExcludeFromCaptureFunc = edge.func(`
      using System;
      using System.Collections.Generic;
      using System.Runtime.InteropServices;
      using System.Threading.Tasks;

      public class Startup {
        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

        public async Task<object> Invoke(object input) {
          var inputDict = input as IDictionary<string, object>;
          long hwndVal = Convert.ToInt64(inputDict["hwnd"].ToString());
          var hwnd = new IntPtr(hwndVal);
          // WDA_EXCLUDEFROMCAPTURE = 0x00000011
          SetWindowDisplayAffinity(hwnd, 0x00000011);
          return true;
        }
      }
    `);
  }

  async getElementAtPoint(x, y) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    try {
      const promisified = this.promisify(this.getElementAtPointFunc);
      const result = await promisified({ x, y });
      return result;
    } catch (error) {
      console.error('Error getting element at point:', error);
      return null;
    }
  }

  async getFocusedElement() {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    try {
      const promisified = this.promisify(this.getFocusedElementFunc);
      const result = await promisified(null);
      return result;
    } catch (error) {
      console.error('Error getting focused element:', error);
      return null;
    }
  }

  async getForegroundWindow(displayBounds = null, appPid = null) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    if (!this.getForegroundWindowFunc) {
      return null;
    }

    try {
      const promisified = this.promisify(this.getForegroundWindowFunc);
      const input = { displayBounds, appPid };
      const result = await promisified(input);
      
      if (!result) {
        return null;
      }
      
      // Convert BoundingRect to BoundingRectangle with correct format
      if (result.BoundingRect) {
        const rect = result.BoundingRect;
        result.BoundingRectangle = {
          left: rect.X,
          top: rect.Y,
          right: rect.X + rect.Width,
          bottom: rect.Y + rect.Height,
          X: rect.X,
          Y: rect.Y,
          Width: rect.Width,
          Height: rect.Height
        };
      }
      
      return result;
    } catch (error) {
      console.error('Error getting foreground window:', error);
      return null;
    }
  }

  async getWindowElements(processId, displayBounds = null) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    try {
      const promisified = this.promisify(this.getWindowElementsFunc);
      const input = {
        processId: processId,
        displayBounds: displayBounds
      };
      const result = await promisified(input);
      return Array.isArray(result) ? result : [result];
    } catch (error) {
      console.error('Error getting window elements:', error);
      return [];
    }
  }

  async setWindowExcludeFromCapture(hwnd) {
    if (!this.isWindows) return false;
    if (!this.setWindowExcludeFromCaptureFunc) return false;
    try {
      const promisified = this.promisify(this.setWindowExcludeFromCaptureFunc);
      await promisified({ hwnd: hwnd.toString() });
      return true;
    } catch (error) {
      console.error('Error setting window display affinity:', error);
      return false;
    }
  }

  async captureScreenNative(x, y, width, height, quality = 85) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    if (!this.captureScreenNativeFunc) {
      throw new Error('Native screen capture function not initialized');
    }

    try {
      const promisified = this.promisify(this.captureScreenNativeFunc);
      const input = { x, y, width, height, quality };
      const base64 = await promisified(input);
      return base64;
    } catch (error) {
      console.error('Error in native screen capture:', error);
      throw error;
    }
  }
}

module.exports = UIAutomationDetector;
