const { spawn } = require('child_process');
const path = require('path');

/**
 * Windows UI Automation Helper
 * Uses PowerShell to detect UI elements at specific screen coordinates
 */

class UIAutomationDetector {
  constructor() {
    this.isWindows = process.platform === 'win32';
  }

  /**
   * Get UI element at specific coordinates using Windows UI Automation
   * @param {number} x - Screen X coordinate
   * @param {number} y - Screen Y coordinate
   * @returns {Promise<Object>} UI element information
   */
  async getElementAtPoint(x, y) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    return new Promise((resolve, reject) => {
      const psScript = `
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        Add-Type -AssemblyName WindowsBase
        
        try {
            $automation = [System.Windows.Automation.AutomationElement]
            $point = New-Object System.Windows.Point(${x}, ${y})
            $element = $automation::FromPoint($point)
            
            if ($element -eq $null) {
                Write-Output "null"
                exit 0
            }
            
            $props = @{
                Name = $element.Current.Name
                ClassName = $element.Current.ClassName
                ControlType = $element.Current.ControlType.ProgrammaticName
                AutomationId = $element.Current.AutomationId
                ProcessId = $element.Current.ProcessId
                IsEnabled = $element.Current.IsEnabled
                IsOffscreen = $element.Current.IsOffscreen
                BoundingRect = @{
                    X = $element.Current.BoundingRectangle.X
                    Y = $element.Current.BoundingRectangle.Y
                    Width = $element.Current.BoundingRectangle.Width
                    Height = $element.Current.BoundingRectangle.Height
                }
            }
            
            # Try to get parent info
            try {
                $parent = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($element)
                if ($parent -ne $null) {
                    $props.ParentName = $parent.Current.Name
                    $props.ParentClassName = $parent.Current.ClassName
                }
            } catch {}
            
            # Try to get process name
            try {
                $process = Get-Process -Id $props.ProcessId -ErrorAction SilentlyContinue
                if ($process) {
                    $props.ProcessName = $process.Name
                    $props.ProcessPath = $process.Path
                }
            } catch {}
            
            $props | ConvertTo-Json -Depth 3
        }
        catch {
            Write-Error $_.Exception.Message
            exit 1
        }
      `;

      const powershell = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psScript
      ]);

      let stdout = '';
      let stderr = '';

      powershell.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      powershell.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      powershell.on('close', (code) => {
        if (code !== 0 || stderr) {
          reject(new Error(`PowerShell error: ${stderr}`));
          return;
        }

        try {
          const trimmedOutput = stdout.trim();
          if (trimmedOutput === 'null' || !trimmedOutput) {
            resolve(null);
          } else {
            const result = JSON.parse(trimmedOutput);
            resolve(result);
          }
        } catch (e) {
          reject(new Error(`Failed to parse result: ${e.message}`));
        }
      });
    });
  }

  /**
   * Get all UI elements in a specific window by process ID
   * @param {number} processId - Process ID of the target application
   * @returns {Promise<Array>} Array of UI elements
   */
  async getWindowElements(processId) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    return new Promise((resolve, reject) => {
      const psScript = `
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        Add-Type -AssemblyName WindowsBase
        
        try {
            $automation = [System.Windows.Automation.AutomationElement]
            $condition = New-Object System.Windows.Automation.PropertyCondition(
                $automation::ProcessIdProperty, 
                ${processId}
            )
            
            $root = $automation::RootElement
            $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
            
            $result = @()
            foreach ($element in $elements) {
                try {
                    $result += @{
                        Name = $element.Current.Name
                        ClassName = $element.Current.ClassName
                        ControlType = $element.Current.ControlType.ProgrammaticName
                        AutomationId = $element.Current.AutomationId
                        IsEnabled = $element.Current.IsEnabled
                        BoundingRect = @{
                            X = $element.Current.BoundingRectangle.X
                            Y = $element.Current.BoundingRectangle.Y
                            Width = $element.Current.BoundingRectangle.Width
                            Height = $element.Current.BoundingRectangle.Height
                        }
                    }
                } catch {}
            }
            
            $result | ConvertTo-Json -Depth 3
        }
        catch {
            Write-Error $_.Exception.Message
            exit 1
        }
      `;

      const powershell = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psScript
      ]);

      let stdout = '';
      let stderr = '';

      powershell.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      powershell.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      powershell.on('close', (code) => {
        if (code !== 0 || stderr) {
          reject(new Error(`PowerShell error: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve(Array.isArray(result) ? result : [result]);
        } catch (e) {
          reject(new Error(`Failed to parse result: ${e.message}`));
        }
      });
    });
  }

  /**
   * Get UI element tree for a specific process with hierarchical structure (iterative, no depth limit)
   * @param {number} processId - Process ID of the target application
   * @returns {Promise<Array>} Array of root UI elements with nested children
   */
  async getWindowElementTree(processId) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    return new Promise((resolve, reject) => {
      const psScript = `
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        Add-Type -AssemblyName WindowsBase
        
        try {
            $automation = [System.Windows.Automation.AutomationElement]
            $condition = New-Object System.Windows.Automation.PropertyCondition(
                $automation::ProcessIdProperty, 
                ${processId}
            )
            
            $root = $automation::RootElement
            $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
            
            $result = @()
            $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
            
            foreach ($window in $windows) {
                # Use a queue for breadth-first traversal (iterative, no recursion)
                $queue = New-Object System.Collections.Queue
                $elementMap = @{}
                $elementId = 0
                
                # Add root window
                $windowId = $elementId++
                $queue.Enqueue(@{ Element = $window; Id = $windowId; ParentId = -1 })
                
                # Collect all elements with parent references
                $allElements = @()
                
                while ($queue.Count -gt 0) {
                    $item = $queue.Dequeue()
                    $element = $item.Element
                    $currentId = $item.Id
                    
                    try {
                        $rect = $element.Current.BoundingRectangle
                        $rectX = if ([double]::IsInfinity($rect.X) -or [double]::IsNaN($rect.X)) { 0 } else { $rect.X }
                        $rectY = if ([double]::IsInfinity($rect.Y) -or [double]::IsNaN($rect.Y)) { 0 } else { $rect.Y }
                        $rectWidth = if ([double]::IsInfinity($rect.Width) -or [double]::IsNaN($rect.Width)) { 0 } else { $rect.Width }
                        $rectHeight = if ([double]::IsInfinity($rect.Height) -or [double]::IsNaN($rect.Height)) { 0 } else { $rect.Height }
                        
                        # Clean string values (remove all control characters)
                        function Clean-String {
                            param([string]$str)
                            if (-not $str) { return $str }
                            $chars = $str.ToCharArray()
                            for ($i = 0; $i -lt $chars.Length; $i++) {
                                $code = [int]$chars[$i]
                                if (($code -ge 0 -and $code -le 31) -or $code -eq 127) {
                                    $chars[$i] = ' '
                                }
                            }
                            $cleaned = -join $chars
                            $cleaned = $cleaned -replace "  +", " "
                            return $cleaned
                        }
                        
                        $name = Clean-String $element.Current.Name
                        $className = Clean-String $element.Current.ClassName
                        $automationId = Clean-String $element.Current.AutomationId
                        
                        $elementData = @{
                            Id = $currentId
                            ParentId = $item.ParentId
                            Name = $name
                            ClassName = $className
                            ControlType = $element.Current.ControlType.ProgrammaticName
                            AutomationId = $automationId
                            ProcessId = $element.Current.ProcessId
                            IsEnabled = $element.Current.IsEnabled
                            IsOffscreen = $element.Current.IsOffscreen
                            BoundingRect = @{
                                X = $rectX
                                Y = $rectY
                                Width = $rectWidth
                                Height = $rectHeight
                            }
                        }
                        
                        $allElements += $elementData
                        
                        # Queue all children
                        try {
                            $child = $walker.GetFirstChild($element)
                            while ($child -ne $null) {
                                $childId = $elementId++
                                $queue.Enqueue(@{ Element = $child; Id = $childId; ParentId = $currentId })
                                $child = $walker.GetNextSibling($child)
                            }
                        } catch {}
                    } catch {}
                }
                
                # Build hierarchical structure from flat list
                $elementMap = @{}
                foreach ($elem in $allElements) {
                    $elem.Children = @()
                    $elementMap[[string]$elem.Id] = $elem
                }
                
                # Link children to parents
                foreach ($elem in $allElements) {
                    if ($elem.ParentId -ge 0 -and $elementMap.ContainsKey([string]$elem.ParentId)) {
                        $elementMap[[string]$elem.ParentId].Children += $elem
                    }
                }
                
                # Get root element and add process info
                $rootElem = $elementMap[[string]$windowId]
                if ($rootElem -ne $null) {
                    try {
                        $process = Get-Process -Id ${processId} -ErrorAction SilentlyContinue
                        if ($process) {
                            $rootElem.ProcessName = $process.Name
                            $rootElem.ProcessPath = $process.Path
                        }
                    } catch {}
                    
                    # Remove Id and ParentId from output (cleanup)
                    function Clean-Element {
                        param($elem)
                        $elem.Remove('Id')
                        $elem.Remove('ParentId')
                        foreach ($child in $elem.Children) {
                            Clean-Element $child
                        }
                    }
                    Clean-Element $rootElem
                    
                    $result += $rootElem
                }
            }
            
            if ($result.Count -eq 0) {
                Write-Output "[]"
            } else {
                $outputPath = [System.IO.Path]::Combine($env:TEMP, "ui-tree-${processId}.json")
                $result | ConvertTo-Json -Depth 100 | Out-File -FilePath $outputPath -Encoding UTF8
                Write-Output $outputPath
            }
        }
        catch {
            Write-Error $_.Exception.Message
            exit 1
        }
      `;

      const powershell = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psScript
      ]);

      let stdout = '';
      let stderr = '';

      powershell.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      powershell.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      powershell.on('close', (code) => {
        if (code !== 0 || stderr) {
          reject(new Error(`PowerShell error: ${stderr}`));
          return;
        }

        try {
          const output = stdout.trim();
          
          if (output === '[]') {
            resolve([]);
          } else if (output.endsWith('.json')) {
            // Read from file
            const fs = require('fs');
            let fileContent = fs.readFileSync(output, 'utf8');
            
            // Strip UTF-8 BOM if present
            if (fileContent.charCodeAt(0) === 0xFEFF) {
              fileContent = fileContent.slice(1);
            }
            
            // Remove control characters from JSON
            fileContent = fileContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
            
            const result = JSON.parse(fileContent);
            
            // Clean up temp file
            try { fs.unlinkSync(output); } catch(e) {}
            
            resolve(Array.isArray(result) ? result : [result]);
          } else {
            const result = JSON.parse(output);
            resolve(Array.isArray(result) ? result : [result]);
          }
        } catch (e) {
          reject(new Error(`Failed to parse result: ${e.message}`));
        }
      });
    });
  }

  /**
   * Get element tree starting from a specific point (shows parents up and children down)
   * @param {number} x - Screen X coordinate
   * @param {number} y - Screen Y coordinate
   * @param {number} maxDepth - Maximum tree depth to traverse up and down (default: 5)
   * @returns {Promise<Object>} UI element tree with parents and children
   */
  async getElementTreeAtPoint(x, y, maxDepth = 5) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    return new Promise((resolve, reject) => {
      const psScript = `
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        Add-Type -AssemblyName WindowsBase
        
        function Get-ChildrenTree {
            param($element, $depth, $maxDepth, $isTarget)
            
            if ($depth -gt $maxDepth -or $element -eq $null) {
                return $null
            }
            
            try {
                $props = @{
                    Name = $element.Current.Name
                    ClassName = $element.Current.ClassName
                    ControlType = $element.Current.ControlType.ProgrammaticName
                    AutomationId = $element.Current.AutomationId
                    ProcessId = $element.Current.ProcessId
                    IsEnabled = $element.Current.IsEnabled
                    IsOffscreen = $element.Current.IsOffscreen
                    BoundingRect = @{
                        X = $element.Current.BoundingRectangle.X
                        Y = $element.Current.BoundingRectangle.Y
                        Width = $element.Current.BoundingRectangle.Width
                        Height = $element.Current.BoundingRectangle.Height
                    }
                    IsTarget = $isTarget
                    Children = @()
                }
                
                # Get all children
                try {
                    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
                    $child = $walker.GetFirstChild($element)
                    
                    while ($child -ne $null) {
                        $childTree = Get-ChildrenTree -element $child -depth ($depth + 1) -maxDepth $maxDepth -isTarget $false
                        if ($childTree -ne $null) {
                            $props.Children += $childTree
                        }
                        $child = $walker.GetNextSibling($child)
                    }
                } catch {}
                
                return $props
            }
            catch {
                return $null
            }
        }
        
        function Build-TreeWithParents {
            param($element, $targetElement, $depth, $maxDepth)
            
            if ($element -eq $null -or $depth -gt $maxDepth) {
                return $null
            }
            
            try {
                $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
                $parent = $walker.GetParent($element)
                
                # Check if this is the target element
                $isTarget = ($element.GetHashCode() -eq $targetElement.GetHashCode())
                
                # Build this element's tree with its children
                $tree = Get-ChildrenTree -element $element -depth 0 -maxDepth $maxDepth -isTarget $isTarget
                
                if ($parent -ne $null -and $depth -lt $maxDepth) {
                    # Recursively build parent tree
                    $parentTree = Build-TreeWithParents -element $parent -targetElement $targetElement -depth ($depth + 1) -maxDepth $maxDepth
                    
                    if ($parentTree -ne $null) {
                        # Replace the current element in parent's children with the full tree
                        for ($i = 0; $i -lt $parentTree.Children.Count; $i++) {
                            $child = $parentTree.Children[$i]
                            if ($child.Name -eq $tree.Name -and $child.ClassName -eq $tree.ClassName) {
                                $parentTree.Children[$i] = $tree
                                break
                            }
                        }
                        return $parentTree
                    }
                }
                
                return $tree
            }
            catch {
                return $null
            }
        }
        
        try {
            $automation = [System.Windows.Automation.AutomationElement]
            $point = New-Object System.Windows.Point(${x}, ${y})
            $element = $automation::FromPoint($point)
            
            if ($element -eq $null) {
                Write-Output "null"
                exit 0
            }
            
            # Build tree with parents going up and children going down
            $tree = Build-TreeWithParents -element $element -targetElement $element -depth 0 -maxDepth ${maxDepth}
            
            if ($tree -ne $null) {
                # Add process info
                try {
                    $process = Get-Process -Id $tree.ProcessId -ErrorAction SilentlyContinue
                    if ($process) {
                        $tree.ProcessName = $process.Name
                        $tree.ProcessPath = $process.Path
                    }
                } catch {}
                
                $tree | ConvertTo-Json -Depth ${maxDepth * 2 + 2}
            } else {
                Write-Output "null"
            }
        }
        catch {
            Write-Error $_.Exception.Message
            exit 1
        }
      `;

      const powershell = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psScript
      ]);

      let stdout = '';
      let stderr = '';

      powershell.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      powershell.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      powershell.on('close', (code) => {
        if (code !== 0 || stderr) {
          reject(new Error(`PowerShell error: ${stderr}`));
          return;
        }

        try {
          const trimmedOutput = stdout.trim();
          if (trimmedOutput === 'null' || !trimmedOutput) {
            resolve(null);
          } else {
            const result = JSON.parse(trimmedOutput);

            console.log('result', result);
            resolve(result);
          }
        } catch (e) {
          reject(new Error(`Failed to parse result: ${e.message}`));
        }
      });
    });
  }

  /**
   * Get focused UI element
   * @returns {Promise<Object>} Currently focused UI element
   */
  async getFocusedElement() {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    return new Promise((resolve, reject) => {
      const psScript = `
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        Add-Type -AssemblyName WindowsBase
        
        try {
            $automation = [System.Windows.Automation.AutomationElement]
            $element = $automation::FocusedElement
            
            if ($element -eq $null) {
                Write-Output "null"
                exit 0
            }
            
            $props = @{
                Name = $element.Current.Name
                ClassName = $element.Current.ClassName
                ControlType = $element.Current.ControlType.ProgrammaticName
                AutomationId = $element.Current.AutomationId
                ProcessId = $element.Current.ProcessId
                IsEnabled = $element.Current.IsEnabled
                BoundingRect = @{
                    X = $element.Current.BoundingRectangle.X
                    Y = $element.Current.BoundingRectangle.Y
                    Width = $element.Current.BoundingRectangle.Width
                    Height = $element.Current.BoundingRectangle.Height
                }
            }
            
            # Try to get process name
            try {
                $process = Get-Process -Id $props.ProcessId -ErrorAction SilentlyContinue
                if ($process) {
                    $props.ProcessName = $process.Name
                    $props.ProcessPath = $process.Path
                }
            } catch {}
            
            $props | ConvertTo-Json -Depth 3
        }
        catch {
            Write-Error $_.Exception.Message
            exit 1
        }
      `;

      const powershell = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psScript
      ]);

      let stdout = '';
      let stderr = '';

      powershell.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      powershell.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      powershell.on('close', (code) => {
        if (code !== 0 || stderr) {
          reject(new Error(`PowerShell error: ${stderr}`));
          return;
        }

        try {
          const trimmedOutput = stdout.trim();
          if (trimmedOutput === 'null' || !trimmedOutput) {
            resolve(null);
          } else {
            const result = JSON.parse(trimmedOutput);
            resolve(result);
          }
        } catch (e) {
          reject(new Error(`Failed to parse result: ${e.message}`));
        }
      });
    });
  }

  /**
   * Start listening for UI Automation events (Invoke, Focus Change, etc.)
   * @param {Function} callback - Called when an event occurs with element data
   * @returns {Object} Event listener handle with stop() method
   */
  startEventListener(callback) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    let psProcess = null;
    let isRunning = true;

    const psScript = `
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      Add-Type -AssemblyName WindowsBase
      
      # Create automation instance
      $automation = [System.Windows.Automation.Automation]
      
      # Generic handler for all automation events
      $eventHandler = {
        param($src, $e)
        try {
          $element = $src
          if ($element -eq $null) { return }
          
          # Get process name safely
          $procName = 'Unknown'
          try {
            $proc = Get-Process -Id $element.Current.ProcessId -ErrorAction SilentlyContinue
            if ($proc) { $procName = $proc.ProcessName }
          } catch { }
          
          $data = @{
            EventType = 'AutomationEvent'
            Timestamp = (Get-Date).ToString('o')
            Name = $element.Current.Name
            ClassName = $element.Current.ClassName
            ControlType = $element.Current.ControlType.ProgrammaticName
            AutomationId = $element.Current.AutomationId
            ProcessId = $element.Current.ProcessId
            ProcessName = $procName
            IsEnabled = $element.Current.IsEnabled
            BoundingRect = @{
              X = [int]$element.Current.BoundingRectangle.X
              Y = [int]$element.Current.BoundingRectangle.Y
              Width = [int]$element.Current.BoundingRectangle.Width
              Height = [int]$element.Current.BoundingRectangle.Height
            }
          } | ConvertTo-Json -Compress
          
          Write-Output "EVENT:$data"
          [Console]::Out.Flush()
        } catch {
          # Silently ignore errors
        }
      }
      
      # Handler for Focus Changed events
      $focusHandler = {
        param($src, $e)
        try {
          $element = $src
          if ($element -eq $null) { return }
          
          # Get process name safely
          $procName = 'Unknown'
          try {
            $proc = Get-Process -Id $element.Current.ProcessId -ErrorAction SilentlyContinue
            if ($proc) { $procName = $proc.ProcessName }
          } catch { }
          
          $data = @{
            EventType = 'FocusChanged'
            Timestamp = (Get-Date).ToString('o')
            Name = $element.Current.Name
            ClassName = $element.Current.ClassName
            ControlType = $element.Current.ControlType.ProgrammaticName
            AutomationId = $element.Current.AutomationId
            ProcessId = $element.Current.ProcessId
            ProcessName = $procName
            IsEnabled = $element.Current.IsEnabled
            BoundingRect = @{
              X = [int]$element.Current.BoundingRectangle.X
              Y = [int]$element.Current.BoundingRectangle.Y
              Width = [int]$element.Current.BoundingRectangle.Width
              Height = [int]$element.Current.BoundingRectangle.Height
            }
          } | ConvertTo-Json -Compress
          
          Write-Output "EVENT:$data"
          [Console]::Out.Flush()
        } catch {
          # Silently ignore errors
        }
      }
      
      # Register for multiple automation events
      try {
        # Invoke event (button clicks via automation)
        $invokeEvent = [System.Windows.Automation.InvokePattern]::InvokedEvent
        $automation::AddAutomationEventHandler(
          $invokeEvent,
          [System.Windows.Automation.AutomationElement]::RootElement,
          [System.Windows.Automation.TreeScope]::Descendants,
          $eventHandler
        )
        Write-Output "INFO:Registered Invoke event handler"
      } catch {
        Write-Output "WARN:Failed to register Invoke handler"
      }
      
      try {
        # Selection event (when items are selected)
        $selectionEvent = [System.Windows.Automation.SelectionItemPattern]::ElementSelectedEvent
        $automation::AddAutomationEventHandler(
          $selectionEvent,
          [System.Windows.Automation.AutomationElement]::RootElement,
          [System.Windows.Automation.TreeScope]::Descendants,
          $eventHandler
        )
        Write-Output "INFO:Registered Selection event handler"
      } catch {
        Write-Output "WARN:Failed to register Selection handler"
      }
      
      try {
        # Window opened event
        $windowEvent = [System.Windows.Automation.WindowPattern]::WindowOpenedEvent
        $automation::AddAutomationEventHandler(
          $windowEvent,
          [System.Windows.Automation.AutomationElement]::RootElement,
          [System.Windows.Automation.TreeScope]::Descendants,
          $eventHandler
        )
        Write-Output "INFO:Registered Window event handler"
      } catch {
        Write-Output "WARN:Failed to register Window handler"
      }
      
      # Register for Focus Changed events (this captures most interactions)
      $automation::AddAutomationFocusChangedEventHandler($focusHandler)
      Write-Output "INFO:Registered Focus event handler"
      
      Write-Output "READY"
      [Console]::Out.Flush()
      
      # Keep the script running
      while ($true) {
        Start-Sleep -Milliseconds 100
      }
    `;

    psProcess = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', psScript
    ]);

    console.log('🚀 PowerShell process spawned for UIA Event Listener');

    let buffer = '';

    psProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('📥 PowerShell stdout:', output.substring(0, 200)); // Log first 200 chars
      
      buffer += output;
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      lines.forEach(line => {
        const trimmed = line.trim();
        console.log('📝 Processing line:', trimmed.substring(0, 100));
        
        if (trimmed.startsWith('EVENT:')) {
          try {
            const jsonStr = trimmed.substring(6);
            const eventData = JSON.parse(jsonStr);
            console.log('✅ Event parsed successfully:', eventData.EventType);
            callback(null, eventData);
          } catch (e) {
            console.error('Failed to parse UIA event:', e, 'Raw:', trimmed);
          }
        } else if (trimmed === 'READY') {
          console.log('✅ UIA Event Listener PowerShell script READY');
        } else if (trimmed.length > 0) {
          console.log('ℹ️ Other output:', trimmed);
        }
      });
    });

    psProcess.stderr.on('data', (data) => {
      console.error('❌ UIA Event Listener stderr:', data.toString());
    });

    psProcess.on('close', (code) => {
      if (isRunning) {
        console.log('🛑 UIA Event Listener stopped with code:', code);
      }
    });

    // Return handle to stop the listener
    return {
      stop: () => {
        isRunning = false;
        if (psProcess) {
          psProcess.kill();
          psProcess = null;
        }
      }
    };
  }

  /**
   * Find UI elements by name across all applications
   * @param {string} name - Name to search for (partial match)
   * @param {number} processId - Optional process ID to limit search scope
   * @returns {Promise<Array>} Array of matching UI elements
   */
  async findElementsByName(name, processId = null) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    return new Promise((resolve, reject) => {
      const processCondition = processId ? `
        $processCondition = New-Object System.Windows.Automation.PropertyCondition(
            $automation::ProcessIdProperty, 
            ${processId}
        )
      ` : '$processCondition = [System.Windows.Automation.Condition]::TrueCondition';

      const psScript = `
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        Add-Type -AssemblyName WindowsBase
        
        try {
            $automation = [System.Windows.Automation.AutomationElement]
            $searchName = "${name.replace(/"/g, '""')}"
            
            ${processCondition}
            
            $root = $automation::RootElement
            $allElements = $root.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants, 
                $processCondition
            )
            
            # Function to clean control characters from strings
            function Clean-String {
                param([string]$str)
                if (-not $str) { return $str }
                $chars = $str.ToCharArray()
                for ($i = 0; $i -lt $chars.Length; $i++) {
                    $code = [int]$chars[$i]
                    if (($code -ge 0 -and $code -le 31) -or $code -eq 127) {
                        $chars[$i] = ' '
                    }
                }
                $cleaned = -join $chars
                $cleaned = $cleaned -replace "  +", " "
                return $cleaned
            }
            
            $result = @()
            foreach ($element in $allElements) {
                try {
                    $elementName = $element.Current.Name
                    if ($elementName -and $elementName -like "*$searchName*") {
                        $rect = $element.Current.BoundingRectangle
                        $rectX = if ([double]::IsInfinity($rect.X) -or [double]::IsNaN($rect.X)) { 0 } else { $rect.X }
                        $rectY = if ([double]::IsInfinity($rect.Y) -or [double]::IsNaN($rect.Y)) { 0 } else { $rect.Y }
                        $rectWidth = if ([double]::IsInfinity($rect.Width) -or [double]::IsNaN($rect.Width)) { 0 } else { $rect.Width }
                        $rectHeight = if ([double]::IsInfinity($rect.Height) -or [double]::IsNaN($rect.Height)) { 0 } else { $rect.Height }
                        
                        $processId = $element.Current.ProcessId
                        $processName = ""
                        $processPath = ""
                        try {
                            $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
                            if ($proc) {
                                $processName = $proc.Name
                                $processPath = $proc.Path
                            }
                        } catch {}
                        
                        $name = Clean-String $element.Current.Name
                        $className = Clean-String $element.Current.ClassName
                        $automationId = Clean-String $element.Current.AutomationId
                        
                        $result += @{
                            Name = $name
                            ClassName = $className
                            ControlType = $element.Current.ControlType.ProgrammaticName
                            AutomationId = $automationId
                            ProcessId = $processId
                            ProcessName = $processName
                            ProcessPath = $processPath
                            IsEnabled = $element.Current.IsEnabled
                            IsOffscreen = $element.Current.IsOffscreen
                            IsKeyboardFocusable = $element.Current.IsKeyboardFocusable
                            BoundingRect = @{
                                X = $rectX
                                Y = $rectY
                                Width = $rectWidth
                                Height = $rectHeight
                            }
                        }
                    }
                } catch {}
            }
            
            $result | ConvertTo-Json -Depth 3 -Compress
        }
        catch {
            Write-Error $_.Exception.Message
            exit 1
        }
      `;

      const powershell = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psScript
      ]);

      let stdout = '';
      let stderr = '';

      powershell.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      powershell.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      powershell.on('close', (code) => {
        if (code !== 0 || stderr) {
          reject(new Error(`PowerShell error: ${stderr}`));
          return;
        }

        try {
          const trimmedOutput = stdout.trim();
          if (!trimmedOutput || trimmedOutput === '[]') {
            resolve([]);
          } else {
            const result = JSON.parse(trimmedOutput);
            resolve(Array.isArray(result) ? result : [result]);
          }
        } catch (e) {
          reject(new Error(`Failed to parse result: ${e.message}\nOutput: ${stdout.substring(0, 200)}`));
        }
      });
    });
  }

  /**
   * Find UI elements within a coordinate range
   * @param {number} x - Start X coordinate
   * @param {number} y - Start Y coordinate
   * @param {number} width - Width of search area
   * @param {number} height - Height of search area
   * @param {number} processId - Optional process ID to limit search scope
   * @returns {Promise<Array>} Array of UI elements within the specified range
   */
  async findElementsInRange(x, y, width, height, processId = null) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    return new Promise((resolve, reject) => {
      const processCondition = processId ? `
        $processCondition = New-Object System.Windows.Automation.PropertyCondition(
            $automation::ProcessIdProperty, 
            ${processId}
        )
      ` : '$processCondition = [System.Windows.Automation.Condition]::TrueCondition';

      const psScript = `
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        Add-Type -AssemblyName WindowsBase
        
        try {
            $automation = [System.Windows.Automation.AutomationElement]
            $searchX = ${x}
            $searchY = ${y}
            $searchWidth = ${width}
            $searchHeight = ${height}
            $searchX2 = $searchX + $searchWidth
            $searchY2 = $searchY + $searchHeight
            
            ${processCondition}
            
            $root = $automation::RootElement
            $allElements = $root.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants, 
                $processCondition
            )
            
            # Function to clean control characters from strings
            function Clean-String {
                param([string]$str)
                if (-not $str) { return $str }
                $chars = $str.ToCharArray()
                for ($i = 0; $i -lt $chars.Length; $i++) {
                    $code = [int]$chars[$i]
                    if (($code -ge 0 -and $code -le 31) -or $code -eq 127) {
                        $chars[$i] = ' '
                    }
                }
                $cleaned = -join $chars
                $cleaned = $cleaned -replace "  +", " "
                return $cleaned
            }
            
            $result = @()
            foreach ($element in $allElements) {
                try {
                    $rect = $element.Current.BoundingRectangle
                    
                    # Skip elements with invalid coordinates
                    if ([double]::IsInfinity($rect.X) -or [double]::IsNaN($rect.X) -or 
                        [double]::IsInfinity($rect.Y) -or [double]::IsNaN($rect.Y)) {
                        continue
                    }
                    
                    $rectX = $rect.X
                    $rectY = $rect.Y
                    $rectWidth = if ([double]::IsInfinity($rect.Width) -or [double]::IsNaN($rect.Width)) { 0 } else { $rect.Width }
                    $rectHeight = if ([double]::IsInfinity($rect.Height) -or [double]::IsNaN($rect.Height)) { 0 } else { $rect.Height }
                    $rectX2 = $rectX + $rectWidth
                    $rectY2 = $rectY + $rectHeight
                    
                    # Check if element intersects with search area
                    $intersects = -not (
                        $rectX2 -lt $searchX -or 
                        $rectX -gt $searchX2 -or 
                        $rectY2 -lt $searchY -or 
                        $rectY -gt $searchY2
                    )
                    
                    if ($intersects) {
                        $processId = $element.Current.ProcessId
                        $processName = ""
                        $processPath = ""
                        try {
                            $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
                            if ($proc) {
                                $processName = $proc.Name
                                $processPath = $proc.Path
                            }
                        } catch {}
                        
                        $name = Clean-String $element.Current.Name
                        $className = Clean-String $element.Current.ClassName
                        $automationId = Clean-String $element.Current.AutomationId
                        
                        $result += @{
                            Name = $name
                            ClassName = $className
                            ControlType = $element.Current.ControlType.ProgrammaticName
                            AutomationId = $automationId
                            ProcessId = $processId
                            ProcessName = $processName
                            ProcessPath = $processPath
                            IsEnabled = $element.Current.IsEnabled
                            IsOffscreen = $element.Current.IsOffscreen
                            IsKeyboardFocusable = $element.Current.IsKeyboardFocusable
                            BoundingRect = @{
                                X = $rectX
                                Y = $rectY
                                Width = $rectWidth
                                Height = $rectHeight
                            }
                        }
                    }
                } catch {}
            }
            
            $result | ConvertTo-Json -Depth 3 -Compress
        }
        catch {
            Write-Error $_.Exception.Message
            exit 1
        }
      `;

      const powershell = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psScript
      ]);

      let stdout = '';
      let stderr = '';

      powershell.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      powershell.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      powershell.on('close', (code) => {
        if (code !== 0 || stderr) {
          reject(new Error(`PowerShell error: ${stderr}`));
          return;
        }

        try {
          const trimmedOutput = stdout.trim();
          if (!trimmedOutput || trimmedOutput === '[]') {
            resolve([]);
          } else {
            const result = JSON.parse(trimmedOutput);
            resolve(Array.isArray(result) ? result : [result]);
          }
        } catch (e) {
          reject(new Error(`Failed to parse result: ${e.message}\nOutput: ${stdout.substring(0, 200)}`));
        }
      });
    });
  }

  /**
   * Get all process IDs of windows visible in a display area
   * @param {number} x - Display X coordinate
   * @param {number} y - Display Y coordinate
   * @param {number} width - Display width
   * @param {number} height - Display height
   * @returns {Promise<Array>} Array of process IDs
   */
  async getProcessIdsInDisplay(x, y, width, height) {
    if (!this.isWindows) {
      throw new Error('UI Automation is only available on Windows');
    }

    return new Promise((resolve, reject) => {
      const psScript = `
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        Add-Type -AssemblyName WindowsBase
        
        try {
            $automation = [System.Windows.Automation.AutomationElement]
            $displayX = ${x}
            $displayY = ${y}
            $displayWidth = ${width}
            $displayHeight = ${height}
            $displayX2 = $displayX + $displayWidth
            $displayY2 = $displayY + $displayHeight
            
            # Get all window elements
            $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
                $automation::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Window
            )
            
            $root = $automation::RootElement
            $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
            
            $processIds = @()
            foreach ($window in $windows) {
                try {
                    $rect = $window.Current.BoundingRectangle
                    
                    # Skip invalid coordinates
                    if ([double]::IsInfinity($rect.X) -or [double]::IsNaN($rect.X)) {
                        continue
                    }
                    
                    $winX = $rect.X
                    $winY = $rect.Y
                    $winWidth = if ([double]::IsInfinity($rect.Width) -or [double]::IsNaN($rect.Width)) { 0 } else { $rect.Width }
                    $winHeight = if ([double]::IsInfinity($rect.Height) -or [double]::IsNaN($rect.Height)) { 0 } else { $rect.Height }
                    $winX2 = $winX + $winWidth
                    $winY2 = $winY + $winHeight
                    
                    # Check if window intersects with display
                    $intersects = -not (
                        $winX2 -lt $displayX -or 
                        $winX -gt $displayX2 -or 
                        $winY2 -lt $displayY -or 
                        $winY -gt $displayY2
                    )
                    
                    if ($intersects) {
                        $processId = $window.Current.ProcessId
                        if ($processId -and $processIds -notcontains $processId) {
                            $processIds += $processId
                        }
                    }
                } catch {}
            }
            
            $processIds | ConvertTo-Json -Compress
        }
        catch {
            Write-Error $_.Exception.Message
            exit 1
        }
      `;

      const powershell = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psScript
      ]);

      let stdout = '';
      let stderr = '';

      powershell.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      powershell.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      powershell.on('close', (code) => {
        if (code !== 0 || stderr) {
          reject(new Error(`PowerShell error: ${stderr}`));
          return;
        }

        try {
          const trimmedOutput = stdout.trim();
          if (!trimmedOutput || trimmedOutput === '[]') {
            resolve([]);
          } else {
            const result = JSON.parse(trimmedOutput);
            resolve(Array.isArray(result) ? result : [result]);
          }
        } catch (e) {
          reject(new Error(`Failed to parse result: ${e.message}\nOutput: ${stdout.substring(0, 200)}`));
        }
      });
    });
  }
}

module.exports = UIAutomationDetector;
