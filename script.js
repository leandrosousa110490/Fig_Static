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

    // Shape drawing state
    const shapeModeButton = document.getElementById('shape-mode');
    const shapeDropdown = document.getElementById('shape-dropdown');
    let currentShapeType = null;
    let isShaping = false;
    let shapeStart = { x: 0, y: 0 };
    let shapeCurrent = { x: 0, y: 0 };

    // Rotation state
    let isRotating = false;
    let rotateStartAngle = 0;
    let initialRotation = 0;
    const rotationHandleDistance = 30; // world units offset above object

    // Frame/Section drawing state
    const frameModeButton = document.getElementById('frame-mode');
    const frameDropdown = document.getElementById('frame-dropdown');
    let currentFrameDrawType = null; // 'frame' or 'section'
    let isFraming = false;
    let frameStart = { x: 0, y: 0 };
    let frameCurrent = { x: 0, y: 0 };

    // --- Core Drawing and Transformation Functions ---
    function redrawCanvas() {
        // Clear the canvas with the background color
        // Important: clearRect needs to cover the entire *visible* canvas area in canvas coordinates
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform to clear
        // Set canvas background based on dark mode
        if (document.body.classList.contains('dark-mode')) {
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-background').trim();
        } else {
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-background').trim(); // Or a default light color if var not found
        }
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        // Apply current transformations
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        // Draw all stored objects with rotation
        paths.forEach(obj => {
            if (!obj.visible) return;
            ctx.save();
            // Rotate around object center
            const center = getObjectCenter(obj);
            const angle = obj.rotation || 0;
            ctx.translate(center.x, center.y);
            ctx.rotate(angle);
            ctx.translate(-center.x, -center.y);

            ctx.beginPath();
            ctx.strokeStyle = obj.color || '#000000';
            ctx.lineWidth = obj.lineWidth || 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (obj.type === 'rectangle') {
                ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
            } else if (obj.type === 'circle') {
                ctx.arc(obj.cx, obj.cy, obj.r, 0, Math.PI * 2);
                ctx.stroke();
            } else if (obj.type === 'triangle' || obj.type === 'star') {
                const pts = obj.points;
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                ctx.closePath();
                ctx.stroke();
            } else if (obj.type === 'frame' || obj.type === 'section') {
                ctx.lineWidth = (obj.type === 'frame') ? 2 : 1;
                ctx.strokeStyle = (obj.type === 'frame') ? obj.color || '#007BFF' : obj.color || '#AAAAAA';
                ctx.setLineDash((obj.type === 'section') ? [5, 5] : []);
                ctx.strokeRect(obj.x, obj.y, obj.width, obj.height);
                ctx.setLineDash([]);
                // Optional: Add title for sections
                if (obj.type === 'section') {
                    ctx.fillStyle = obj.color || '#333333';
                    ctx.font = `bold ${14/scale}px sans-serif`;
                    ctx.textAlign = 'left';
                    ctx.fillText(obj.name || 'Section', obj.x + (5/scale), obj.y + (18/scale));
                }
            } else if (obj.points) {  // freehand path
                if (obj.points.length < 2) { ctx.restore(); return; }
                ctx.moveTo(obj.points[0].x, obj.points[0].y);
                for (let i = 1; i < obj.points.length; i++) ctx.lineTo(obj.points[i].x, obj.points[i].y);
                ctx.stroke();
            }

            // Draw selection indicators (bounding box, resize handles, rotate handle) INSIDE rotated context
            if (obj.selected) {
                const bb = obj.boundingBox;
                // Draw bounding box (now appears rotated)
                ctx.strokeStyle = 'rgba(0, 100, 255, 0.7)';
                ctx.lineWidth = 1 / scale;
                ctx.setLineDash([5 / scale, 5 / scale]);
                ctx.strokeRect(bb.minX, bb.minY, bb.maxX - bb.minX, bb.maxY - bb.minY);
                ctx.setLineDash([]);

                // Draw resize handles (now appear rotated)
                const hs = handleSize / scale;
                [[bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.maxX, bb.maxY], [bb.minX, bb.maxY]]
                    .forEach(([x, y]) => {
                        ctx.fillStyle = '#ffffff';
                        ctx.strokeStyle = '#000000';
                        ctx.fillRect(x - hs/2, y - hs/2, hs, hs);
                        ctx.strokeRect(x - hs/2, y - hs/2, hs, hs);
                    });

                // Draw rotation handle (now appears rotated)
                const rotHandleY = bb.minY - (rotationHandleDistance / scale);
                ctx.beginPath();
                ctx.arc(center.x, rotHandleY, handleSize/(2*scale), 0, Math.PI*2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.strokeStyle = '#000000';
                ctx.stroke();
            }
            ctx.restore();
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

        // Draw preview shape if in shape mode
        if (isShaping && currentMode === 'shape') {
            ctx.beginPath();
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = 2;
            const x0 = shapeStart.x, y0 = shapeStart.y;
            const x1 = shapeCurrent.x, y1 = shapeCurrent.y;
            if (currentShapeType === 'rectangle') {
                const x = Math.min(x0, x1), y = Math.min(y0, y1);
                const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
                ctx.strokeRect(x, y, w, h);
            } else if (currentShapeType === 'circle') {
                const dx = x1 - x0, dy = y1 - y0;
                const r = Math.hypot(dx, dy);
                ctx.arc(x0, y0, r, 0, Math.PI * 2);
                ctx.stroke();
            } else if (currentShapeType === 'triangle') {
                const p0 = { x: x0, y: y0 };
                const p1 = { x: x1, y: y0 };
                const p2 = { x: x0, y: y1 };
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.closePath();
                ctx.stroke();
            } else if (currentShapeType === 'star') {
                // Preview a 5-point star within bounding box
                const x = Math.min(x0, x1), y = Math.min(y0, y1);
                const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
                const cx = x + w/2, cy = y + h/2;
                const outerR = Math.min(w, h)/2;
                const innerR = outerR * 0.5;
                const pts = [];
                for (let i = 0; i < 10; i++) {
                    const angle = Math.PI/2 + i * (2 * Math.PI / 10);
                    const r = i % 2 === 0 ? outerR : innerR;
                    pts.push({ x: cx + Math.cos(angle)*r, y: cy + Math.sin(angle)*r });
                }
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
                ctx.closePath();
                ctx.stroke();
            }
        }

        // Draw preview frame/section if in framing mode
        if (isFraming && currentFrameDrawType) {
            ctx.beginPath();
            ctx.lineWidth = (currentFrameDrawType === 'frame') ? 2 : 1; // Thicker for frame, thinner for section
            ctx.strokeStyle = (currentFrameDrawType === 'frame') ? '#007BFF' : '#AAAAAA'; // Blue for frame, grey for section
            ctx.setLineDash((currentFrameDrawType === 'section') ? [5, 5] : []);
            const x = Math.min(frameStart.x, frameCurrent.x), y = Math.min(frameStart.y, frameCurrent.y);
            const w = Math.abs(frameCurrent.x - frameStart.x), h = Math.abs(frameCurrent.y - frameStart.y);
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
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
                boundingBox: calculateBoundingBox({ points: [...currentPathPoints] })
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

        // Move object based on type
        if (selectedPath.type === 'rectangle' || selectedPath.type === 'frame' || selectedPath.type === 'section') {
            selectedPath.x += dx;
            selectedPath.y += dy;
            selectedPath.boundingBox.minX += dx;
            selectedPath.boundingBox.minY += dy;
            selectedPath.boundingBox.maxX += dx;
            selectedPath.boundingBox.maxY += dy;
        } else if (selectedPath.type === 'circle') {
            selectedPath.cx += dx;
            selectedPath.cy += dy;
            selectedPath.boundingBox.minX += dx;
            selectedPath.boundingBox.minY += dy;
            selectedPath.boundingBox.maxX += dx;
            selectedPath.boundingBox.maxY += dy;
        } else if (selectedPath.type === 'triangle' || selectedPath.type === 'star') {
            selectedPath.points.forEach(pt => { pt.x += dx; pt.y += dy; });
            selectedPath.boundingBox = calculateBoundingBox(selectedPath);
        } else {
            selectedPath.points.forEach(point => { point.x += dx; point.y += dy; });
            selectedPath.boundingBox = calculateBoundingBox(selectedPath);
        }
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
            } else if (currentMode === 'shape') {
                isShaping = true;
                shapeStart = getMousePos(e);
                shapeCurrent = { ...shapeStart };
            } else if (currentMode === 'select') {
                const handle = getHandleAtPosition(selectedPath || {}, pos);
                if (selectedPath && handle === 'rotate') {
                    startRotate(e, selectedPath);
                } else if (selectedPath && handle) {
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
            } else if (currentMode === 'frameDraw') {
                isFraming = true;
                frameStart = getMousePos(e);
                frameCurrent = { ...frameStart };
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
        if (isShaping && currentMode === 'shape') {
            shapeCurrent = getMousePos(e);
            redrawCanvas();
            return;
        }
        if (isRotating) {
            rotatePath(e);
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
                else if (handle === 'rotate') cursor = 'alias'; // Set alias cursor for rotate handle
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
        } else if (isFraming && currentMode === 'frameDraw') {
            frameCurrent = getMousePos(e);
            redrawCanvas();
            return;
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (isResizing) {
            stopResize();
        }
        if (isRotating) {
            stopRotate();
        }
        if (e.button === 0) {
            if (isDrawing) stopDrawing();
            else if (isDragging) stopDrag();
            else if (isShaping && currentMode === 'shape') {
                isShaping = false;
                // finalize shape
                const x0 = shapeStart.x, y0 = shapeStart.y;
                const x1 = shapeCurrent.x, y1 = shapeCurrent.y;
                let newObj;
                if (currentShapeType === 'rectangle') {
                    const x = Math.min(x0, x1), y = Math.min(y0, y1);
                    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
                    newObj = { id: nextPathId++, type: 'rectangle', tool: 'Rectangle', visible: true,
                        x, y, width: w, height: h, color: currentColor, lineWidth: 2,
                        boundingBox: calculateBoundingBox({type: 'rectangle', x, y, width: w, height: h })
                    };
                } else if (currentShapeType === 'circle') {
                    const dx = x1 - x0, dy = y1 - y0;
                    const r = Math.hypot(dx, dy);
                    newObj = { id: nextPathId++, type: 'circle', tool: 'Circle', visible: true,
                        cx: x0, cy: y0, r, color: currentColor, lineWidth: 2,
                        boundingBox: calculateBoundingBox({type: 'circle', cx: x0, cy: y0, r })
                    };
                } else if (currentShapeType === 'triangle') {
                    const p0 = { x: x0, y: y0 };
                    const p1 = { x: x1, y: y0 };
                    const p2 = { x: x0, y: y1 };
                    const bb = calculateBoundingBox({points: [p0, p1, p2]});
                    newObj = { id: nextPathId++, type: 'triangle', tool: 'Triangle', visible: true,
                        points: [p0, p1, p2], color: currentColor, lineWidth: 2, boundingBox: bb
                    };
                } else if (currentShapeType === 'star') {
                    // Finalize star shape
                    const x = Math.min(x0, x1), y = Math.min(y0, y1);
                    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
                    const cx = x + w/2, cy = y + h/2;
                    const outerR = Math.min(w, h)/2;
                    const innerR = outerR * 0.5;
                    const pts = [];
                    for (let i = 0; i < 10; i++) {
                        const angle = Math.PI/2 + i * (2 * Math.PI / 10);
                        const r = i % 2 === 0 ? outerR : innerR;
                        pts.push({ x: cx + Math.cos(angle)*r, y: cy + Math.sin(angle)*r });
                    }
                    const bbStar = calculateBoundingBox({points: pts});
                    newObj = { id: nextPathId++, type: 'star', tool: 'Star', visible: true,
                        points: pts, color: currentColor, lineWidth: 2, boundingBox: bbStar
                    };
                }
                paths.push(newObj);
                selectPath(newObj);
                redrawCanvas();
                updateLayersPanel();
                updatePropertiesPanel();
                return;
            } else if (isFraming && currentMode === 'frameDraw') {
                isFraming = false;
                const x = Math.min(frameStart.x, frameCurrent.x), y = Math.min(frameStart.y, frameCurrent.y);
                const w = Math.abs(frameCurrent.x - frameStart.x), h = Math.abs(frameCurrent.y - frameStart.y);
                if (w > 0 && h > 0) {
                    const frameObj = {
                        id: nextPathId++,
                        type: currentFrameDrawType,
                        tool: currentFrameDrawType.charAt(0).toUpperCase() + currentFrameDrawType.slice(1), // 'Frame' or 'Section'
                        name: currentFrameDrawType === 'section' ? 'Section' : 'Frame',
                        visible: true,
                        x, y, width: w, height: h,
                        color: (currentFrameDrawType === 'frame') ? '#007BFF' : '#AAAAAA',
                        lineWidth: (currentFrameDrawType === 'frame') ? 2 : 1,
                        boundingBox: calculateBoundingBox({type: currentFrameDrawType, x, y, width:w, height:h}),
                        children: [], // For nesting objects later
                        rotation: 0
                    };
                    paths.push(frameObj);
                    selectPath(frameObj);
                    updateLayersPanel();
                    updatePropertiesPanel();
                }
                redrawCanvas();
                return;
            }
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
    const darkModeToggleButton = document.getElementById('dark-mode-toggle'); // Added
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

    // Toggle shape dropdown
    shapeModeButton.addEventListener('click', () => {
        shapeDropdown.classList.toggle('visible');
    });
    // Select shape type
    shapeDropdown.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            currentShapeType = e.target.dataset.shape;
            currentMode = 'shape';
            canvas.style.cursor = 'crosshair';
            setActiveButton(shapeModeButton);
            shapeDropdown.classList.remove('visible');
        });
    });

    // Toggle frame dropdown
    frameModeButton.addEventListener('click', () => {
        frameDropdown.classList.toggle('visible');
    });

    // Select frame/section type and enter drawing mode
    frameDropdown.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            currentFrameDrawType = e.target.dataset.frameType;
            currentMode = 'frameDraw'; // New mode for drawing frames/sections
            canvas.style.cursor = 'crosshair';
            setActiveButton(frameModeButton); // Keep frame tool active
            frameDropdown.classList.remove('visible');
            isDrawing = false; isShaping = false; // Ensure other drawing modes are off
            console.log(`${currentFrameDrawType} drawing mode selected`);
        });
    });

    // --- Dark Mode Toggle Logic --- (Add this new section)
    darkModeToggleButton.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        // Optionally, change button icon based on mode
        if (document.body.classList.contains('dark-mode')) {
            darkModeToggleButton.textContent = '🌙'; // Moon for dark mode
        } else {
            darkModeToggleButton.textContent = '☀️'; // Sun for light mode
        }
        // Redraw canvas if its appearance depends on dark mode (e.g., background)
        // For now, the canvas background itself is white, so a redraw might not be strictly necessary
        // unless elements within it are styled based on body class.
        redrawCanvas(); 
    });

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

        if (selectedPath.type === 'section') {
            const nameDiv = document.createElement('div');
            nameDiv.style.marginBottom = '8px';
            const nameLabel = document.createElement('label');
            nameLabel.textContent = 'Name: ';
            nameLabel.htmlFor = 'prop-name-input';
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.id = 'prop-name-input';
            nameInput.value = selectedPath.name || '';
            nameInput.addEventListener('input', (e) => {
                selectedPath.name = e.target.value;
                redrawCanvas(); // To update section title
                updateLayersPanel(); // To update layer name
            });
            nameDiv.appendChild(nameLabel);
            nameDiv.appendChild(nameInput);
            propertiesPanelElement.appendChild(nameDiv);
        }
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

        // Size properties - Show for rectangle, frame, section, or anything with a boundingBox
        if (selectedPath.type === 'rectangle' || selectedPath.type === 'frame' || selectedPath.type === 'section' || (selectedPath.points && selectedPath.points.length > 0) ) {
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
            widthInput.value = parseFloat(currentW.toFixed(2));
            widthInput.style.width = '60px';
            widthInput.addEventListener('change', (e) => {
                const newW = parseFloat(e.target.value);
                if (newW > 0 && currentW > 0) {
                    const scaleX = newW / currentW;
                    if (selectedPath.type === 'rectangle' || selectedPath.type === 'frame' || selectedPath.type === 'section') {
                        selectedPath.x = bb.minX; // Assuming resize from top-left for property change
                        selectedPath.width *= scaleX;
                    } else if (selectedPath.points) { // For point-based objects (triangle, star, freehand)
                        selectedPath.points.forEach(pt => {
                            pt.x = bb.minX + (pt.x - bb.minX) * scaleX;
                        });
                    }
                    selectedPath.boundingBox = calculateBoundingBox(selectedPath.points || selectedPath); // Recalculate based on type
                    redrawCanvas();
                    updatePropertiesPanel(); // Refresh properties
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
            heightInput.value = parseFloat(currentH.toFixed(2));
            heightInput.style.width = '60px';
            heightInput.addEventListener('change', (e) => {
                const newH = parseFloat(e.target.value);
                if (newH > 0 && currentH > 0) {
                    const scaleY = newH / currentH;
                     if (selectedPath.type === 'rectangle' || selectedPath.type === 'frame' || selectedPath.type === 'section') {
                        selectedPath.y = bb.minY; // Assuming resize from top-left
                        selectedPath.height *= scaleY;
                    } else if (selectedPath.points) { // For point-based objects
                        selectedPath.points.forEach(pt => {
                            pt.y = bb.minY + (pt.y - bb.minY) * scaleY;
                        });
                    }
                    selectedPath.boundingBox = calculateBoundingBox(selectedPath.points || selectedPath); // Recalculate
                    redrawCanvas();
                    updatePropertiesPanel(); // Refresh properties
                }
            });
            heightDiv.appendChild(heightLabel);
            heightDiv.appendChild(heightInput);
            propertiesPanelElement.appendChild(heightDiv);
        }
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

    function calculateBoundingBox(object) {
        if (!object) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

        if (object.type === 'rectangle' || object.type === 'frame' || object.type === 'section') {
            return { minX: object.x, minY: object.y, maxX: object.x + object.width, maxY: object.y + object.height };
        } else if (object.type === 'circle') {
            return { minX: object.cx - object.r, minY: object.cy - object.r, maxX: object.cx + object.r, maxY: object.cy + object.r };
        } else if (object.points && object.points.length > 0) {
            // For paths, triangles, stars
            let minX = object.points[0].x;
            let minY = object.points[0].y;
            let maxX = object.points[0].x;
            let maxY = object.points[0].y;
            for (let i = 1; i < object.points.length; i++) {
                minX = Math.min(minX, object.points[i].x);
                minY = Math.min(minY, object.points[i].y);
                maxX = Math.max(maxX, object.points[i].x);
                maxY = Math.max(maxY, object.points[i].y);
            }
            return { minX, minY, maxX, maxY };
        } else if (object.x !== undefined && object.y !== undefined && object.width !== undefined && object.height !== undefined) {
            // Fallback for objects that might be passed directly without being in `paths` array yet (e.g. during creation)
            return { minX: object.x, minY: object.y, maxX: object.x + object.width, maxY: object.y + object.height };
        }
        // Default for unrecognized or incomplete objects
        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    function isPointInBox(point, box) {
        return point.x >= box.minX && point.x <= box.maxX &&
               point.y >= box.minY && point.y <= box.maxY;
    }

    // Add utility to get object center
    function getObjectCenter(obj) {
        if (obj.type === 'rectangle') {
            return { x: obj.x + obj.width/2, y: obj.y + obj.height/2 };
        } else if (obj.type === 'circle') {
            return { x: obj.cx, y: obj.cy };
        } else if (obj.type === 'triangle' || obj.type === 'star') {
            const bb = obj.boundingBox;
            return { x: (bb.minX + bb.maxX)/2, y: (bb.minY + bb.maxY)/2 };
        } else if (obj.points) { // freehand path
            const bb = obj.boundingBox;
            return { x: (bb.minX + bb.maxX)/2, y: (bb.minY + bb.maxY)/2 };
        }
        return { x: 0, y: 0 };
    }

    // Update getHandleAtPosition to account for object rotation
    function getHandleAtPosition(path, mousePosWorld) {
        if (!path || !path.boundingBox || !path.selected) return null;

        const objectCenter = getObjectCenter(path);
        const objectRotation = path.rotation || 0;

        // Transform mouse position into the object's local (unrotated) coordinate system
        let localMousePos = { x: mousePosWorld.x, y: mousePosWorld.y };
        if (objectRotation !== 0) {
            // Translate mouse so objectCenter is the origin
            let translatedX = mousePosWorld.x - objectCenter.x;
            let translatedY = mousePosWorld.y - objectCenter.y;

            // Rotate mouse position by -objectRotation
            const cosNegRotation = Math.cos(-objectRotation);
            const sinNegRotation = Math.sin(-objectRotation);
            const rotatedX = translatedX * cosNegRotation - translatedY * sinNegRotation;
            const rotatedY = translatedX * sinNegRotation + translatedY * cosNegRotation;

            // Translate mouse back
            localMousePos = { x: rotatedX + objectCenter.x, y: rotatedY + objectCenter.y };
        }

        const bb = path.boundingBox; // Bounding box is in object's unrotated space relative to its x,y or points
        const hSizeScaled = handleSize / scale;
        const halfHandle = hSizeScaled / 2;

        // Check rotation handle (position is relative to unrotated object center and bb)
        const rotHandleCenterY = bb.minY - (rotationHandleDistance / scale); // Y position of rotate handle in object's unrotated space
        // The rotation handle is centered horizontally above the bounding box (using objectCenter.x)
        if (localMousePos.x >= objectCenter.x - halfHandle && localMousePos.x <= objectCenter.x + halfHandle &&
            localMousePos.y >= rotHandleCenterY - halfHandle && localMousePos.y <= rotHandleCenterY + halfHandle) {
            return 'rotate';
        }

        // Check resize handles (corners and edges of the unrotated bounding box)
        const corners = {
            nw: { x: bb.minX, y: bb.minY },
            ne: { x: bb.maxX, y: bb.minY },
            se: { x: bb.maxX, y: bb.maxY },
            sw: { x: bb.minX, y: bb.maxY }
        };

        for (const dir in corners) {
            const h = corners[dir];
            if (localMousePos.x >= h.x - halfHandle && localMousePos.x <= h.x + halfHandle &&
                localMousePos.y >= h.y - halfHandle && localMousePos.y <= h.y + halfHandle) {
                return dir;
            }
        }

        // Edge handles (check against unrotated bounding box edges)
        // North edge
        if (localMousePos.x >= bb.minX + halfHandle && localMousePos.x <= bb.maxX - halfHandle && Math.abs(localMousePos.y - bb.minY) <= halfHandle) {
            return 'n';
        }
        // South edge
        if (localMousePos.x >= bb.minX + halfHandle && localMousePos.x <= bb.maxX - halfHandle && Math.abs(localMousePos.y - bb.maxY) <= halfHandle) {
            return 's';
        }
        // West edge
        if (localMousePos.y >= bb.minY + halfHandle && localMousePos.y <= bb.maxY - halfHandle && Math.abs(localMousePos.x - bb.minX) <= halfHandle) {
            return 'w';
        }
        // East edge
        if (localMousePos.y >= bb.minY + halfHandle && localMousePos.y <= bb.maxY - halfHandle && Math.abs(localMousePos.x - bb.maxX) <= halfHandle) {
            return 'e';
        }

        return null;
    }

    // Start resizing
    function startResize(e, path, handle) {
        if (!path) return;
        isResizing = true;
        resizeHandle = handle;
        originalBB = { ...path.boundingBox };
        // Handle shape types
        if (path.type === 'rectangle' || path.type === 'frame' || path.type === 'section') {
            path.originalRect = { x: path.x, y: path.y, width: path.width, height: path.height };
        } else if (path.type === 'circle') {
            path.originalCircle = { cx: path.cx, cy: path.cy, r: path.r };
            // pivot is always center
            pivotX = path.originalCircle.cx;
            pivotY = path.originalCircle.cy;
        } else if (path.type === 'triangle' || path.type === 'star') {
            originalPoints = path.points.map(p => ({ x: p.x, y: p.y }));
            // pivot set below
        } else { // freehand
            originalPoints = path.points.map(p => ({ x: p.x, y: p.y }));
        }
        // Determine pivot based on handle (use boundingBox for rectangles, triangles, freehand)
        if (path.type !== 'circle') {
            switch (handle) {
                case 'nw': pivotX = originalBB.maxX; pivotY = originalBB.maxY; break;
                case 'ne': pivotX = originalBB.minX; pivotY = originalBB.maxY; break;
                case 'se': pivotX = originalBB.minX; pivotY = originalBB.minY; break;
                case 'sw': pivotX = originalBB.maxX; pivotY = originalBB.minY; break;
                case 'n':  pivotX = (originalBB.minX + originalBB.maxX)/2; pivotY = originalBB.maxY; break;
                case 's':  pivotX = (originalBB.minX + originalBB.maxX)/2; pivotY = originalBB.minY; break;
                case 'w':  pivotX = originalBB.maxX; pivotY = (originalBB.minY + originalBB.maxY)/2; break;
                case 'e':  pivotX = originalBB.minX; pivotY = (originalBB.minY + originalBB.maxY)/2; break;
            }
        }
        // Set cursor based on handle
        let cursor = 'default';
        if (['nw','se'].includes(handle)) cursor = 'nwse-resize';
        else if (['ne','sw'].includes(handle)) cursor = 'nesw-resize';
        else if (['n','s'].includes(handle))  cursor = 'ns-resize';
        else if (['e','w'].includes(handle))  cursor = 'ew-resize';
        canvas.style.cursor = cursor;
    }

    // Perform resizing
    function resizePath(e) {
        if (!isResizing || !selectedPath) return;
        const worldMousePos = getMousePos(e);

        const objectCenter = getObjectCenter(selectedPath);
        const objectRotation = selectedPath.rotation || 0;
        let localMousePos = { x: worldMousePos.x, y: worldMousePos.y };

        // Transform mouse position to object's local (unrotated) coordinate system
        // if the object is rotated.
        if (objectRotation !== 0) {
            // Translate mouse so objectCenter is the origin for rotation
            let translatedX = worldMousePos.x - objectCenter.x;
            let translatedY = worldMousePos.y - objectCenter.y;

            // Rotate mouse position by -objectRotation
            const cosNegRotation = Math.cos(-objectRotation);
            const sinNegRotation = Math.sin(-objectRotation);
            const rotatedX = translatedX * cosNegRotation - translatedY * sinNegRotation;
            const rotatedY = translatedX * sinNegRotation + translatedY * cosNegRotation;

            // Translate mouse back
            localMousePos = { x: rotatedX + objectCenter.x, y: rotatedY + objectCenter.y };
        }

        // Now, use localMousePos for all calculations instead of worldMousePos (or the old 'pos')

        // Resize based on type
        if (selectedPath.type === 'rectangle' || selectedPath.type === 'frame' || selectedPath.type === 'section') {
            const rect = selectedPath.originalRect; // originalRect is unrotated
            let nx = rect.x, ny = rect.y, nw = rect.width, nh = rect.height;

            // Calculate new dimensions based on localMousePos and the unrotated pivot
            if ([ 'nw', 'sw', 'w' ].includes(resizeHandle)) {
                nw = pivotX - localMousePos.x;
                nx = localMousePos.x;
            }
            if ([ 'ne', 'se', 'e' ].includes(resizeHandle)) {
                nw = localMousePos.x - pivotX;
                nx = pivotX;
            }
            if ([ 'nw', 'ne', 'n' ].includes(resizeHandle)) {
                nh = pivotY - localMousePos.y;
                ny = localMousePos.y;
            }
            if ([ 'sw', 'se', 's' ].includes(resizeHandle)) {
                nh = localMousePos.y - pivotY;
                ny = pivotY;
            }

            // Preserve aspect ratio if shift is held (optional, not implemented here)
            // Apply new dimensions (these are in the object's local, unrotated frame)
            if (nw > 0) { selectedPath.x = nx; selectedPath.width = nw; }
            if (nh > 0) { selectedPath.y = ny; selectedPath.height = nh; }
            selectedPath.boundingBox = calculateBoundingBox(selectedPath);
        } else if (selectedPath.type === 'circle') {
            // For circle, pivot is always center (objectCenter used for localMousePos transformation)
            // Radius is distance from center to localMousePos
            const dx = localMousePos.x - selectedPath.originalCircle.cx; // originalCircle.cx is unrotated center
            const dy = localMousePos.y - selectedPath.originalCircle.cy; // originalCircle.cy is unrotated center
            const nr = Math.hypot(dx, dy);
            if (nr > 0) selectedPath.r = nr;
            // cx, cy of circle don't change during radius resize
            selectedPath.boundingBox = calculateBoundingBox(selectedPath);
        } else if (selectedPath.points) { // For triangle, star, freehand paths
            const oldW = originalBB.maxX - originalBB.minX;
            const oldH = originalBB.maxY - originalBB.minY;
            if (oldW === 0 || oldH === 0) return; // Avoid division by zero

            let newW, newH;
            // Calculate new dimensions in local space
            switch(resizeHandle) {
                case 'nw': newW = pivotX - localMousePos.x; newH = pivotY - localMousePos.y; break;
                case 'ne': newW = localMousePos.x - pivotX; newH = pivotY - localMousePos.y; break;
                case 'se': newW = localMousePos.x - pivotX; newH = localMousePos.y - pivotY; break;
                case 'sw': newW = pivotX - localMousePos.x; newH = localMousePos.y - pivotY; break;
                case 'n':  newW = oldW; newH = pivotY - localMousePos.y; break;
                case 's':  newW = oldW; newH = localMousePos.y - pivotY; break;
                case 'w':  newW = pivotX - localMousePos.x; newH = oldH; break;
                case 'e':  newW = localMousePos.x - pivotX; newH = oldH; break;
                default: return; // Should not happen
            }

            const scaleX = (oldW === 0) ? 1 : newW / oldW;
            const scaleY = (oldH === 0) ? 1 : newH / oldH;

            // originalPoints are in unrotated local space, pivotX/pivotY are also in that space.
            selectedPath.points = originalPoints.map(p => ({
                x: pivotX + (p.x - pivotX) * scaleX,
                y: pivotY + (p.y - pivotY) * scaleY
            }));
            selectedPath.boundingBox = calculateBoundingBox(selectedPath);
        }
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

    // Add rotation functions
    function startRotate(e, path) {
        isRotating = true;
        const pos = getMousePos(e);
        const center = getObjectCenter(path);
        rotatePivot = center;
        rotateStartAngle = Math.atan2(pos.y - center.y, pos.x - center.x);
        initialRotation = path.rotation || 0;
        canvas.style.cursor = 'alias'; // Changed cursor for rotation
    }

    function rotatePath(e) {
        if (!isRotating || !selectedPath) return;
        const pos = getMousePos(e);
        const angle = Math.atan2(pos.y - rotatePivot.y, pos.x - rotatePivot.x);
        selectedPath.rotation = initialRotation + (angle - rotateStartAngle);
        redrawCanvas();
    }

    function stopRotate() {
        if (!isRotating) return;
        isRotating = false;
        canvas.style.cursor = 'default';
        updatePropertiesPanel();
    }

    console.log('Figma clone: Select, Move, Pan, Zoom implemented.');
}); 