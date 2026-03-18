/**::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
@license Zoomify Image Viewer, version on line 25 below. Copyright Zoomify, Inc., 1999-2016. All rights reserved. You may
use this file on private and public websites, for personal and commercial purposes, with or without modifications, so long as this
notice is included. Redistribution via other means is not permitted without prior permission. Additional terms apply. For complete
license terms please see the Zoomify License Agreement in this product and on the Zoomify website at www.zoomify.com.
::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
*/

(function () {
	// Declare global-to-page object to contain global-to-viewer elements.
	var global = (function () { return this; } ).call();
	global.ZXS = {};
})();



//::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::
//:::::::::::::::::::::: ZOOMIFY EXTERNAL SLIDER FUNCTIONS ::::::::::::::::::::::::::
//::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

// THE FOLLOWING ZOOM SLIDER VARIABLES AND FUNCTIONS ARE STORED SEPARATELY FROM
// THE WEB PAGE SO THAT IT CAN REMAIN SIMPLE AND SEPARATELY FROM THE ZOOMIFY VIEWER
// SO THAT IT CAN BE THIS IMPLEMENTATION CAN BE CUSTOMIZED WITHOUT NEEDING TO 
// RE-ADD CHANGES TO THE VIEWER WHEN NEW VERSIONS ARE RELEASED.


var trsZ, trszS, bsdZ, bsdzS, trackL, trackR, trackSpan;
var buttonSliderZoomDown = false;
var sliderIntervalZoom = null, sliderIntervalMousePtZoom = null;

ZXS.initExternalZoomSlider = function () {
	trsZ = document.getElementById('zoomSliderTrack');
	bsdZ = document.getElementById('buttonSliderDiv');
	trszS = Z.Utils.getElementStyle(trsZ);
	bsdzS = Z.Utils.getElementStyle(bsdZ);
	bsdZ.style.left = trsZ.offsetLeft - 2 + 'px';
	bsdZ.style.top = trsZ.offsetTop - 4 + 'px';
	trackL = trsZ.offsetLeft - 2;
	trackR = trackL + parseFloat(trszS.width) - parseFloat(bsdzS.width) + 4;
	trackSpan = trackR - trackL;
	Z.Utils.addEventListener(bsdZ, 'mousedown', sliderButtonMouseDownHandler);
	Z.setCallback('viewZoomingGetCurrentZoom', syncSliderToViewportZoom);	
	var btnZO = document.getElementById('zoomOut');
	var btnZI = document.getElementById('zoomIn');
	if (btnZO && btnZI) {
		Z.Utils.addEventListener(btnZO, 'mousedown', zoomButtonMouseDownHandler);
		Z.Utils.addEventListener(btnZO, 'mousedown', zoomButtonMouseUpHandler);
		Z.Utils.addEventListener(btnZI, 'mousedown', zoomButtonMouseDownHandler);
		Z.Utils.addEventListener(btnZI, 'mousedown', zoomButtonMouseUpHandler);
	}
}

function sliderMouseMoveHandlerZoom (event) {
	sliderIntervalMousePtZoom = new Z.Utils.Point(event.clientX, event.clientY);
}

function sliderTouchMoveHandlerZoom (event) {
	var touch = Z.Utils.getFirstTouch(event);
	if (touch) {
		var target = touch.target;
		sliderIntervalMousePtZoom = new Z.Utils.Point(touch.pageX, touch.pageY);
	}
}

function syncSliderToViewportZoom (imageZ) {
	if (!buttonSliderZoomDown && !sliderIntervalZoom && typeof trszS !== 'undefined' && typeof bsdZ !== 'undefined') {
		var imageSpan = Z.maxZ - Z.minZ;
		var sliderPercent = (imageZ - Z.minZ) / imageSpan;
		var sliderPosition = (sliderPercent * trackSpan) + trackL;
		bsdZ.style.left = sliderPosition + 'px';
	}
}

function sliderButtonMouseDownHandler (event) {
	sliderSlideStartZoom(event);
	sliderMouseMoveHandlerZoom(event); // Run once so values are defined at first movement.
	Z.Utils.removeEventListener(document, 'mousedown', sliderButtonMouseDownHandler);
	Z.Utils.addEventListener(document, 'mousemove', sliderMouseMoveHandlerZoom);
	Z.Utils.addEventListener(document, 'touchmove', sliderTouchMoveHandlerZoom);
	Z.Utils.addEventListener(document, 'mouseup', sliderSlideEndZoom);
	Z.Utils.addEventListener(document, 'touchend', sliderSlideEndZoom);
	if (!sliderIntervalZoom) { sliderIntervalZoom = window.setInterval(sliderSlideZoom, 10); }
}

function sliderSlideStartZoom (event) {
	if (typeof bsdZ !== 'undefined') {
		buttonSliderZoomDown = true;
		var mPt = Z.Utils.getMousePosition(event);
		bsdZ.mouseXPrior = mPt.x;
		bsdZ.mouseYPrior = mPt.y;
	}
}

function sliderSlideZoom () {
	if (trsZ && trszS && bsdZ && bsdzS) {
		var trackPosition = parseFloat(bsdzS.left) + (sliderIntervalMousePtZoom.x - bsdZ.mouseXPrior);
		if (trackPosition < trackL) {
			trackPosition = trackL;
		} else if (trackPosition > trackR) {
			trackPosition = trackR;
		} else {
			bsdZ.mouseXPrior = sliderIntervalMousePtZoom.x;
		}
		bsdZ.style.left = trackPosition + 'px';
		var sliderZoom = calculateSliderZoom(trackPosition, trackL, trackR);
		var delta = sliderZoom - Z.Viewport.getZoom();
		Z.zooming = (delta > 0) ? 'in' : (delta < 0) ? 'out' : 'stop';
		Z.Viewport.scaleTierToZoom(sliderZoom);
	}
}

function sliderSlideEndZoom () {
	Z.Utils.removeEventListener(document, 'mousemove', sliderMouseMoveHandlerZoom);
	Z.Utils.removeEventListener(document, 'touchmove', sliderTouchMoveHandlerZoom);
	Z.Utils.removeEventListener(document, 'mouseup', sliderSlideEndZoom);
	Z.Utils.removeEventListener(document, 'touchend', sliderSlideEndZoom);
	if (sliderIntervalZoom) {
		window.clearInterval(sliderIntervalZoom);
		sliderIntervalZoom = null;
	}
	buttonSliderZoomDown = false;
	Z.zooming = 'stop';
	Z.Viewport.updateView();
}

function calculateSliderZoom (sliderPosition, trkL, trkR) {
	var trackSpan = trkR - trkL;
	var sliderPercent = (sliderPosition - trkL) / trackSpan;
	var imageSpan = Z.maxZ - Z.minZ;
	var sliderZoom = Z.minZ + (imageSpan * sliderPercent);
	return sliderZoom;
}

function zoomButtonMouseDownHandler () {
	if (sliderIntervalZoom) {
		window.clearInterval(sliderIntervalZoom);
		sliderIntervalZoom = null;
	}
	buttonSliderZoomDown = true;
}

function zoomButtonMouseUpHandler () {
	buttonSliderZoomDown = false;
}
