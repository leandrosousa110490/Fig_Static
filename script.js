document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('main-canvas');
    const ctx = canvas.getContext('2d');
    const canvasArea = document.querySelector('.canvas-area');
    const layersPanelElement = document.querySelector('.layers-panel'); // Get layers panel
    const propertiesPanelElement = document.querySelector('.properties-panel'); // Get properties panel

    let isDrawing = false;
    let isPanning = false;
    let isDragging = false; // For dragging selected objects
    let lastX = 0;
    let lastY = 0;
    let panStartX = 0;
    let panStartY = 0;
    let dragStartX = 0;
    let dragStartY = 0;

    // Canvas dimensions
    const canvasWidth = 3000;
    const canvasHeight = 2000;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Transformation state
    let scale = 1;
    let offsetX = (canvasArea.clientWidth - canvasWidth * scale) / 2; // Initial pan to center
    let offsetY = (canvasArea.clientHeight - canvasHeight * scale) / 2;

    // Store all drawn paths
    const paths = []; // Will store path objects: { id, points, selected, color, lineWidth, boundingBox }
    let currentPathPoints = []; // Temporary points for the path being drawn
    let nextPathId = 1;
    let selectedPath = null;

    // Resize state
    let isResizing = false;
    let resizeHandle = null;
    let originalPoints = [];
    let originalBB = null;
    let pivotX = 0;
    let pivotY = 0;
    const handleSize = 8; // px

    // --- Core Drawing and Transformation Functions ---
    function redrawCanvas() {
        // Clear the canvas with the background color
        // Important: clearRect needs to cover the entire *visible* canvas area in canvas coordinates
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform to clear
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        // Apply current transformations
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        // Redraw all stored paths
        paths.forEach(path => {
            if (!path.visible) return; // Skip hidden paths
            if (path.points.length < 2) return;
            ctx.beginPath();
            ctx.strokeStyle = path.color || '#000000';
            ctx.lineWidth = path.lineWidth || 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.moveTo(path.points[0].x, path.points[0].y);
            for (let i = 1; i < path.points.length; i++) {
                ctx.lineTo(path.points[i].x, path.points[i].y);
            }
            ctx.stroke();

            if (path.selected) {
                // Draw bounding box for selected path
                ctx.strokeStyle = 'rgba(0, 100, 255, 0.7)';
                ctx.lineWidth = 1 / scale; // Keep bounding box line thin
                ctx.setLineDash([5 / scale, 5 / scale]); // Dashed line for selection
                const bb = path.boundingBox;
                ctx.strokeRect(bb.minX, bb.minY, bb.maxX - bb.minX, bb.maxY - bb.minY);
                ctx.setLineDash([]); // Reset line dash
            }
        });

        // Draw the current path if any
        if (isDrawing && currentPathPoints.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = currentColor; // Active drawing color
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.moveTo(currentPathPoints[0].x, currentPathPoints[0].y);
            for (let i = 1; i < currentPathPoints.length; i++) {
                ctx.lineTo(currentPathPoints[i].x, currentPathPoints[i].y);
            }
            ctx.stroke();
        }

        // Draw resize handles for selected
        if (selectedPath && selectedPath.selected) {
            const bb = selectedPath.boundingBox;
            ctx.save();
            // Handles are drawn in world coordinates already transformed by outer translate/scale
            const hs = handleSize / scale;
            [[bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.maxX, bb.maxY], [bb.minX, bb.maxY]]
                .forEach(([x, y]) => {
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 1 / scale;
                    ctx.fillRect(x - hs/2, y - hs/2, hs, hs);
                    ctx.strokeRect(x - hs/2, y - hs/2, hs, hs);
                });
            ctx.restore();
        }

        ctx.restore();
    }

    // Initial draw
    redrawCanvas();


    function getMousePos(e) {
        // Returns mouse position in canvas coordinates (considering transformations)
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;
        // Convert screen coordinates to canvas world coordinates
        const worldX = (clientX - offsetX) / scale;
        const worldY = (clientY - offsetY) / scale;
        return { x: worldX, y: worldY };
    }


    // --- Drawing Logic ---
    function startDrawing(e) {
        if (currentMode !== 'draw') return;
        isDrawing = true;
        const pos = getMousePos(e);
        currentPathPoints = [{ x: pos.x, y: pos.y }]; // Start a new path
        lastX = pos.x;
        lastY = pos.y;
        selectPath(null); // Deselect any path when starting to draw
    }

    function draw(e) {
        if (!isDrawing) return;
        const pos = getMousePos(e);
        currentPathPoints.push({ x: pos.x, y: pos.y });

        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        ctx.beginPath();
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.restore();

        lastX = pos.x;
        lastY = pos.y;
    }

    function stopDrawing() {
        if (!isDrawing) return;
        isDrawing = false;
        if (currentPathPoints.length > 1) {
            const newPath = {
                id: nextPathId++,
                tool: 'Pen',  // Added tool type so layers read 'Pen {id}'
                visible: true, // Track visibility state
                points: [...currentPathPoints],
                selected: false,
                color: currentColor,
                lineWidth: 2,      // Default line width
                boundingBox: calculateBoundingBox([...currentPathPoints])
            };
            paths.push(newPath);
            selectPath(newPath);
        }
        currentPathPoints = [];
        redrawCanvas();
        updateLayersPanel();
    }

    // --- Panning Logic ---
    function startPan(e) {
        // Allow panning when:
        // - Pan tool is active (left mouse)
        // - Select tool is active and clicking empty space (left mouse)
        // - Middle mouse button anywhere
        const isLeftClick = e.button === 0;
        const isMiddleClick = e.button === 1 || e.buttons === 4;
        const clickPos = getMousePos(e);
        const clickedOnEmpty = getPathAtPosition(clickPos) === null;
        if (!(
            (currentMode === 'pan' && isLeftClick) ||
            (currentMode === 'select' && isLeftClick && clickedOnEmpty) ||
            isMiddleClick
        )) return;

        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        canvas.style.cursor = 'grabbing';
    }

    function pan(e) {
        if (!isPanning) return;
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;

        offsetX += dx;
        offsetY += dy;

        panStartX = e.clientX;
        panStartY = e.clientY;

        redrawCanvas();
    }

    function stopPan() {
        if (!isPanning) return;
        isPanning = false;
        if (currentMode === 'select') {
            canvas.style.cursor = 'default';
        } else if (currentMode === 'draw') {
            canvas.style.cursor = 'crosshair';
        } else if (currentMode === 'pan') {
            canvas.style.cursor = 'grab';
        }
    }

    // --- Dragging Logic (for selected objects) ---
    function startDrag(e, path) {
        if (currentMode !== 'select' || !path || !path.selected) return;
        isDragging = true;
        selectedPath = path; // Ensure this is the path we are dragging
        const pos = getMousePos(e);
        dragStartX = pos.x;
        dragStartY = pos.y;
        canvas.style.cursor = 'move';
    }

    function drag(e) {
        if (!isDragging || !selectedPath) return;
        const pos = getMousePos(e);
        const dx = pos.x - dragStartX;
        const dy = pos.y - dragStartY;

        // Move the selected path
        selectedPath.points.forEach(point => {
            point.x += dx;
            point.y += dy;
        });
        // Update its bounding box
        selectedPath.boundingBox = calculateBoundingBox(selectedPath.points);

        dragStartX = pos.x; // Update drag start for next segment
        dragStartY = pos.y;

        redrawCanvas();
    }

    function stopDrag() {
        if (!isDragging) return;
        isDragging = false;
        // Cursor should revert based on current mode
        if (currentMode === 'select') {
            canvas.style.cursor = 'default'; // Or specific cursor if over an object
        }
        // No need to re-select, path is already selected
        redrawCanvas(); // Final redraw to ensure state is clean
        updateLayersPanel(); // Update in case properties change, or for consistency
    }

    // --- Zoom Logic ---
    function handleZoom(e) {
        e.preventDefault(); // Prevent page scrolling

        const zoomIntensity = 0.1;
        const wheel = e.deltaY < 0 ? 1 : -1;
        const zoomFactor = Math.exp(wheel * zoomIntensity);

        // Mouse position relative to the canvas
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Update scale
        scale *= zoomFactor;

        // Adjust offset to keep zoom centered at mouse position
        offsetX = mx - (mx - offsetX) * zoomFactor;
        offsetY = my - (my - offsetY) * zoomFactor;

        redrawCanvas();
    }


    // --- Event Listeners ---
    canvas.addEventListener('mousedown', (e) => {
        const pos = getMousePos(e);
        if (e.button === 0) {
            if (currentMode === 'draw') {
                startDrawing(e);
            } else if (currentMode === 'select') {
                const handle = getHandleAtPosition(selectedPath || {}, pos);
                if (selectedPath && handle) {
                    startResize(e, selectedPath, handle);
                } else {
                    const clickedPath = getPathAtPosition(pos);
                    if (clickedPath) {
                        selectPath(clickedPath);
                        startDrag(e, clickedPath);
                    } else {
                        selectPath(null);
                    }
                }
            } else if (currentMode === 'pan') {
                startPan(e);
            }
        } else if (e.button === 1 || e.buttons === 4) {
            startPan(e);
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const pos = getMousePos(e);
        if (isResizing) {
            resizePath(e);
            return;
        }
        // Change cursor for handle hover
        if (currentMode === 'select' && selectedPath) {
            const handle = getHandleAtPosition(selectedPath, pos);
            if (handle) {
                let cursor = 'default';
                if (handle === 'nw' || handle === 'se') cursor = 'nwse-resize';
                else if (handle === 'ne' || handle === 'sw') cursor = 'nesw-resize';
                else if (handle === 'n' || handle === 's') cursor = 'ns-resize';
                else if (handle === 'e' || handle === 'w') cursor = 'ew-resize';
                canvas.style.cursor = cursor;
                return; // skip other cursors
            }
        }
        if (isDrawing) {
            draw(e);
        } else if (isDragging) {
            drag(e);
        } else if (isPanning) {
            pan(e);
        } else if (currentMode === 'select') {
            const hoverPath = getPathAtPosition(pos);
            canvas.style.cursor = hoverPath ? 'move' : 'default';
        } else if (currentMode === 'pan') {
            canvas.style.cursor = 'grab';
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (isResizing) {
            stopResize();
        }
        if (e.button === 0) {
            if (isDrawing) stopDrawing();
            else if (isDragging) stopDrag();
        }
        if (isPanning) stopPan();
        if (!isDrawing && !isDragging && !isPanning) {
            if (currentMode === 'draw') canvas.style.cursor = 'crosshair';
            else if (currentMode === 'select') {
                const pos = getMousePos(e);
                const hoverPath = getPathAtPosition(pos);
                canvas.style.cursor = hoverPath ? 'move' : 'default';
            } else if (currentMode === 'pan') {
                canvas.style.cursor = 'grab';
            }
        }
    });

    canvas.addEventListener('mouseout', () => {
        if (isPanning) stopPan();
        if (isDragging) stopDrag(); // Stop dragging if mouse leaves canvas
        // Note: We might not want to stop drawing if mouse temporarily leaves and re-enters.
    });

    canvas.addEventListener('wheel', handleZoom, { passive: false });


    // --- Toolbar Button Logic & Mode Switching ---
    const drawModeButton = document.getElementById('draw-mode');
    const selectModeButton = document.getElementById('select-mode');
    const panModeButton = document.getElementById('pan-mode');
    const colorPicker = document.getElementById('color-picker');
    let currentMode = 'draw'; // Default mode
    let currentColor = '#000000'; // Default drawing color
    canvas.style.cursor = 'crosshair'; // Initial cursor for draw mode

    function setActiveButton(activeButton) {
        drawModeButton.classList.remove('active');
        selectModeButton.classList.remove('active');
        panModeButton.classList.remove('active');
        if (activeButton) {
            activeButton.classList.add('active');
        }
    }


    drawModeButton.addEventListener('click', () => {
        currentMode = 'draw';
        canvas.style.cursor = 'crosshair';
        setActiveButton(drawModeButton);
        selectPath(null);
        colorPicker.click();
        console.log('Draw mode selected');
    });

    selectModeButton.addEventListener('click', () => {
        currentMode = 'select';
        canvas.style.cursor = 'default';
        setActiveButton(selectModeButton);
        console.log('Select mode selected');
    });

    panModeButton.addEventListener('click', () => {
        currentMode = 'pan';
        canvas.style.cursor = 'grab';
        setActiveButton(panModeButton);
        console.log('Pan mode selected');
    });

    colorPicker.addEventListener('input', (e) => { currentColor = e.target.value; });

    // Set initial active button
    setActiveButton(drawModeButton);


    // --- Ensure canvas redraws on window resize to keep it centered ---
    // (or to adjust transformations if needed)
    window.addEventListener('resize', () => {
        // Recenter if not much interaction has happened or provide a more sophisticated resize
        if (paths.length === 0) { // Basic recenter on resize if empty
             offsetX = (canvasArea.clientWidth - canvasWidth * scale) / 2;
             offsetY = (canvasArea.clientHeight - canvasHeight * scale) / 2;
        }
        redrawCanvas();
    });

    // --- Layers Panel Update ---
    function updateLayersPanel() {
        layersPanelElement.innerHTML = '<h2>Layers</h2>'; // Clear existing layers
        const ul = document.createElement('ul');
        ul.style.listStyle = 'none';
        ul.style.padding = '0';
        paths.forEach(path => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '5px';
            li.style.borderBottom = '1px solid #eee';
            if (path.selected) {
                li.style.backgroundColor = '#e0efff'; // Highlight selected layer
            }

            const nameSpan = document.createElement('span');
            nameSpan.textContent = `${path.tool} ${path.id}`;
            nameSpan.style.cursor = 'pointer';
            nameSpan.addEventListener('click', () => {
                selectPath(path);
            });

            // Hide/unhide button
            const hideBtn = document.createElement('button');
            hideBtn.textContent = path.visible ? '👁️' : '🚫';
            hideBtn.style.border = 'none';
            hideBtn.style.background = 'transparent';
            hideBtn.style.cursor = 'pointer';
            hideBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                path.visible = !path.visible;
                // Deselect if hidden
                if (!path.visible && selectedPath === path) selectedPath = null;
                redrawCanvas();
                updateLayersPanel();
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '🗑️';
            deleteBtn.style.border = 'none';
            deleteBtn.style.background = 'transparent';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deletePath(path);
            });

            li.appendChild(nameSpan);
            li.appendChild(hideBtn);
            li.appendChild(deleteBtn);
            ul.appendChild(li);
        });
        layersPanelElement.appendChild(ul);
    }
    updateLayersPanel(); // Initial call
    updatePropertiesPanel(); // Initial call for properties panel

    // --- Properties Panel Update ---
    function updatePropertiesPanel() {
        propertiesPanelElement.innerHTML = '<h2>Properties</h2>';
        if (!selectedPath) return;
        // Color property
        const colorDiv = document.createElement('div');
        colorDiv.style.marginBottom = '8px';
        const colorLabel = document.createElement('label');
        colorLabel.textContent = 'Color: ';
        colorLabel.htmlFor = 'prop-color-input';
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.id = 'prop-color-input';
        colorInput.value = selectedPath.color;
        colorInput.addEventListener('input', (e) => {
            selectedPath.color = e.target.value;
            redrawCanvas();
        });
        colorDiv.appendChild(colorLabel);
        colorDiv.appendChild(colorInput);
        propertiesPanelElement.appendChild(colorDiv);
        // Size properties
        const bb = selectedPath.boundingBox;
        const currentW = bb.maxX - bb.minX;
        const currentH = bb.maxY - bb.minY;
        // Width control
        const widthDiv = document.createElement('div');
        widthDiv.style.marginBottom = '8px';
        const widthLabel = document.createElement('label');
        widthLabel.textContent = 'Width: ';
        widthLabel.htmlFor = 'prop-width-input';
        const widthInput = document.createElement('input');
        widthInput.type = 'number';
        widthInput.id = 'prop-width-input';
        widthInput.value = currentW;
        widthInput.style.width = '60px';
        widthInput.addEventListener('change', (e) => {
            const newW = parseFloat(e.target.value);
            if (newW > 0 && currentW > 0) {
                const scaleX = newW / currentW;
                selectedPath.points.forEach(pt => {
                    pt.x = bb.minX + (pt.x - bb.minX) * scaleX;
                });
                selectedPath.boundingBox = calculateBoundingBox(selectedPath.points);
                redrawCanvas();
                updatePropertiesPanel();
            }
        });
        widthDiv.appendChild(widthLabel);
        widthDiv.appendChild(widthInput);
        propertiesPanelElement.appendChild(widthDiv);
        // Height control
        const heightDiv = document.createElement('div');
        heightDiv.style.marginBottom = '8px';
        const heightLabel = document.createElement('label');
        heightLabel.textContent = 'Height: ';
        heightLabel.htmlFor = 'prop-height-input';
        const heightInput = document.createElement('input');
        heightInput.type = 'number';
        heightInput.id = 'prop-height-input';
        heightInput.value = currentH;
        heightInput.style.width = '60px';
        heightInput.addEventListener('change', (e) => {
            const newH = parseFloat(e.target.value);
            if (newH > 0 && currentH > 0) {
                const scaleY = newH / currentH;
                selectedPath.points.forEach(pt => {
                    pt.y = bb.minY + (pt.y - bb.minY) * scaleY;
                });
                selectedPath.boundingBox = calculateBoundingBox(selectedPath.points);
                redrawCanvas();
                updatePropertiesPanel();
            }
        });
        heightDiv.appendChild(heightLabel);
        heightDiv.appendChild(heightInput);
        propertiesPanelElement.appendChild(heightDiv);
    }

    // Function to delete a path by object reference
    function deletePath(pathToDelete) {
        const index = paths.indexOf(pathToDelete);
        if (index !== -1) {
            paths.splice(index, 1);
            if (selectedPath === pathToDelete) {
                selectedPath = null;
            }
            redrawCanvas();
            updateLayersPanel();
            updatePropertiesPanel();
        }
    }

    // --- Selection Logic ---
    function selectPath(pathToSelect) {
        if (selectedPath && selectedPath !== pathToSelect) {
            selectedPath.selected = false;
        }
        if (pathToSelect) {
            pathToSelect.selected = true;
            selectedPath = pathToSelect;
        } else {
            selectedPath = null;
        }
        redrawCanvas();
        updateLayersPanel();
        updatePropertiesPanel();
    }

    function getPathAtPosition(pos) {
        // Iterate in reverse order so top-most paths are checked first
        for (let i = paths.length - 1; i >= 0; i--) {
            const path = paths[i];
            // Crude hit detection: check bounding box first
            // For more accuracy, you'd check distance to path segments
            if (isPointInBox(pos, path.boundingBox)) {
                return path;
            }
        }
        return null;
    }

    function calculateBoundingBox(points) {
        if (!points || points.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        let minX = points[0].x;
        let minY = points[0].y;
        let maxX = points[0].x;
        let maxY = points[0].y;
        for (let i = 1; i < points.length; i++) {
            minX = Math.min(minX, points[i].x);
            minY = Math.min(minY, points[i].y);
            maxX = Math.max(maxX, points[i].x);
            maxY = Math.max(maxY, points[i].y);
        }
        return { minX, minY, maxX, maxY };
    }

    function isPointInBox(point, box) {
        return point.x >= box.minX && point.x <= box.maxX &&
               point.y >= box.minY && point.y <= box.maxY;
    }

    // Add utility to get handle under cursor for a path
    function getHandleAtPosition(path, pos) {
        if (!path || !path.boundingBox) return null;
        const bb = path.boundingBox;
        const half = handleSize / (2 * scale);
        // Corner handles
        const corners = {
            nw: { x: bb.minX, y: bb.minY },
            ne: { x: bb.maxX, y: bb.minY },
            se: { x: bb.maxX, y: bb.maxY },
            sw: { x: bb.minX, y: bb.maxY }
        };
        for (const dir in corners) {
            const h = corners[dir];
            if (pos.x >= h.x - half && pos.x <= h.x + half && pos.y >= h.y - half && pos.y <= h.y + half) {
                return dir;
            }
        }
        // Edge handles (excluding corners region)
        // North edge
        if (pos.x >= bb.minX + half && pos.x <= bb.maxX - half && Math.abs(pos.y - bb.minY) <= half) {
            return 'n';
        }
        // South edge
        if (pos.x >= bb.minX + half && pos.x <= bb.maxX - half && Math.abs(pos.y - bb.maxY) <= half) {
            return 's';
        }
        // West edge
        if (pos.y >= bb.minY + half && pos.y <= bb.maxY - half && Math.abs(pos.x - bb.minX) <= half) {
            return 'w';
        }
        // East edge
        if (pos.y >= bb.minY + half && pos.y <= bb.maxY - half && Math.abs(pos.x - bb.maxX) <= half) {
            return 'e';
        }
        return null;
    }

    // Start resizing
    function startResize(e, path, handle) {
        isResizing = true;
        resizeHandle = handle;
        originalBB = { ...path.boundingBox };
        originalPoints = path.points.map(p => ({ x: p.x, y: p.y }));
        // Determine pivot based on handle
        switch (handle) {
            case 'nw': pivotX = originalBB.maxX; pivotY = originalBB.maxY; break;
            case 'ne': pivotX = originalBB.minX; pivotY = originalBB.maxY; break;
            case 'se': pivotX = originalBB.minX; pivotY = originalBB.minY; break;
            case 'sw': pivotX = originalBB.maxX; pivotY = originalBB.minY; break;
            case 'n':  pivotX = originalBB.minX; pivotY = originalBB.maxY; break;
            case 's':  pivotX = originalBB.minX; pivotY = originalBB.minY; break;
            case 'w':  pivotX = originalBB.maxX; pivotY = originalBB.minY; break;
            case 'e':  pivotX = originalBB.minX; pivotY = originalBB.minY; break;
        }
        // Set cursor based on handle direction
        if (['nw','se'].includes(handle)) canvas.style.cursor = 'nwse-resize';
        else if (['ne','sw'].includes(handle)) canvas.style.cursor = 'nesw-resize';
        else if (['n','s'].includes(handle))  canvas.style.cursor = 'ns-resize';
        else if (['e','w'].includes(handle))  canvas.style.cursor = 'ew-resize';
    }

    // Perform resizing
    function resizePath(e) {
        if (!isResizing || !selectedPath) return;
        const pos = getMousePos(e);
        const oldW = originalBB.maxX - originalBB.minX;
        const oldH = originalBB.maxY - originalBB.minY;
        let newW, newH;
        switch (resizeHandle) {
            case 'nw': newW = pivotX - pos.x;       newH = pivotY - pos.y;       break;
            case 'ne': newW = pos.x - pivotX;       newH = pivotY - pos.y;       break;
            case 'se': newW = pos.x - pivotX;       newH = pos.y - pivotY;       break;
            case 'sw': newW = pivotX - pos.x;       newH = pos.y - pivotY;       break;
            case 'n':  newW = oldW;                 newH = pivotY - pos.y;       break;
            case 's':  newW = oldW;                 newH = pos.y - pivotY;       break;
            case 'w':  newW = pivotX - pos.x;       newH = oldH;                 break;
            case 'e':  newW = pos.x - pivotX;       newH = oldH;                 break;
        }
        const scaleX = newW / oldW;
        const scaleY = newH / oldH;
        // Update points
        selectedPath.points = originalPoints.map(p => ({
            x: pivotX + (p.x - pivotX) * scaleX,
            y: pivotY + (p.y - pivotY) * scaleY
        }));
        selectedPath.boundingBox = calculateBoundingBox(selectedPath.points);
        redrawCanvas();
    }

    // Stop resizing
    function stopResize() {
        if (!isResizing) return;
        isResizing = false;
        canvas.style.cursor = 'default';
        updatePropertiesPanel();
        updateLayersPanel();
    }

    console.log('Figma clone: Select, Move, Pan, Zoom implemented.');
}); 