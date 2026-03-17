import * as THREE from 'three';

const _zee = new THREE.Vector3( 0, 0, 1 );
const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion( - Math.sqrt( 0.5 ), 0, 0, Math.sqrt( 0.5 ) );

class DeviceOrientationControls extends THREE.EventDispatcher {
    constructor( object ) {
        super();
        if ( window.isSecureContext === false ) {
            console.error( 'THREE.DeviceOrientationControls: DeviceOrientationEvent is only available in secure contexts (https)' );
        }
        const scope = this;
        const changeEvent = { type: 'change' };
        const EPS = 0.000001;
        this.object = object;
        this.object.rotation.reorder( 'YXZ' );
        this.enabled = true;
        this.deviceOrientation = {};
        this.screenOrientation = 0;
        this.alphaOffset = 0;
        this.lastQuaternion = new THREE.Quaternion();

        const onDeviceOrientationChangeEvent = function ( event ) {
            scope.deviceOrientation = event;
        };
        const onScreenOrientationChangeEvent = function () {
            scope.screenOrientation = window.orientation || 0;
        };

        const setObjectQuaternion = function ( quaternion, alpha, beta, gamma, orient ) {
            _euler.set( beta, alpha, - gamma, 'YXZ' );
            quaternion.setFromEuler( _euler );
            quaternion.multiply( _q1 );
            quaternion.multiply( _q0.setFromAxisAngle( _zee, - orient ) );
        };

        this.connect = function () {
            onScreenOrientationChangeEvent();
            window.addEventListener( 'orientationchange', onScreenOrientationChangeEvent );
            window.addEventListener( 'deviceorientation', onDeviceOrientationChangeEvent );
            scope.enabled = true;
        };

        this.disconnect = function () {
            window.removeEventListener( 'orientationchange', onScreenOrientationChangeEvent );
            window.removeEventListener( 'deviceorientation', onDeviceOrientationChangeEvent );
            scope.enabled = false;
        };

        this.update = function () {
            if ( scope.enabled === false ) return;
            const device = scope.deviceOrientation;
            if ( device ) {
                const alpha = device.alpha ? THREE.MathUtils.degToRad( device.alpha ) + scope.alphaOffset : 0;
                const beta = device.beta ? THREE.MathUtils.degToRad( device.beta ) : 0;
                const gamma = device.gamma ? THREE.MathUtils.degToRad( device.gamma ) : 0;
                const orient = scope.screenOrientation ? THREE.MathUtils.degToRad( scope.screenOrientation ) : 0;
                setObjectQuaternion( scope.object.quaternion, alpha, beta, gamma, orient );
                if ( 8 * ( 1 - scope.lastQuaternion.dot( scope.object.quaternion ) ) > EPS ) {
                    scope.lastQuaternion.copy( scope.object.quaternion );
                    scope.dispatchEvent( changeEvent );
                }
            }
        };

        this.dispose = function () {
            scope.disconnect();
        };

        this.connect();
    }
}

export { DeviceOrientationControls };