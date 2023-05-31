"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _ApiClient = _interopRequireDefault(require("../ApiClient"));
var _LiveQueueBOARDINGGROUP = _interopRequireDefault(require("./LiveQueueBOARDINGGROUP"));
var _LiveQueuePAIDRETURNTIME = _interopRequireDefault(require("./LiveQueuePAIDRETURNTIME"));
var _LiveQueueRETURNTIME = _interopRequireDefault(require("./LiveQueueRETURNTIME"));
var _LiveQueueSTANDBY = _interopRequireDefault(require("./LiveQueueSTANDBY"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }
function _typeof(obj) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj) { return typeof obj; } : function (obj) { return obj && "function" == typeof Symbol && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); }
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
function _toPropertyKey(arg) { var key = _toPrimitive(arg, "string"); return _typeof(key) === "symbol" ? key : String(key); }
function _toPrimitive(input, hint) { if (_typeof(input) !== "object" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); } /**
                                                                                                                                                                                                                                                                                                                                                                                               * Theme Parks Wiki V1 API
                                                                                                                                                                                                                                                                                                                                                                                               * api.themeparks.wiki
                                                                                                                                                                                                                                                                                                                                                                                               *
                                                                                                                                                                                                                                                                                                                                                                                               * The version of the OpenAPI document: 1.0.0-alpha
                                                                                                                                                                                                                                                                                                                                                                                               * 
                                                                                                                                                                                                                                                                                                                                                                                               *
                                                                                                                                                                                                                                                                                                                                                                                               * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
                                                                                                                                                                                                                                                                                                                                                                                               * https://openapi-generator.tech
                                                                                                                                                                                                                                                                                                                                                                                               * Do not edit the class manually.
                                                                                                                                                                                                                                                                                                                                                                                               *
                                                                                                                                                                                                                                                                                                                                                                                               */
/**
 * The LiveQueue model module.
 * @module model/LiveQueue
 * @version 6.0.0
 */
var LiveQueue = /*#__PURE__*/function () {
  /**
   * Constructs a new <code>LiveQueue</code>.
   * @alias module:model/LiveQueue
   */
  function LiveQueue() {
    _classCallCheck(this, LiveQueue);
    LiveQueue.initialize(this);
  }

  /**
   * Initializes the fields of this object.
   * This method is used by the constructors of any subclasses, in order to implement multiple inheritance (mix-ins).
   * Only for internal use.
   */
  _createClass(LiveQueue, null, [{
    key: "initialize",
    value: function initialize(obj) {}

    /**
     * Constructs a <code>LiveQueue</code> from a plain JavaScript object, optionally creating a new instance.
     * Copies all relevant properties from <code>data</code> to <code>obj</code> if supplied or a new instance if not.
     * @param {Object} data The plain JavaScript object bearing properties of interest.
     * @param {module:model/LiveQueue} obj Optional instance to populate.
     * @return {module:model/LiveQueue} The populated <code>LiveQueue</code> instance.
     */
  }, {
    key: "constructFromObject",
    value: function constructFromObject(data, obj) {
      if (data) {
        obj = obj || new LiveQueue();
        if (data.hasOwnProperty('STANDBY')) {
          obj['STANDBY'] = _LiveQueueSTANDBY["default"].constructFromObject(data['STANDBY']);
        }
        if (data.hasOwnProperty('SINGLE_RIDER')) {
          obj['SINGLE_RIDER'] = _LiveQueueSTANDBY["default"].constructFromObject(data['SINGLE_RIDER']);
        }
        if (data.hasOwnProperty('RETURN_TIME')) {
          obj['RETURN_TIME'] = _LiveQueueRETURNTIME["default"].constructFromObject(data['RETURN_TIME']);
        }
        if (data.hasOwnProperty('PAID_RETURN_TIME')) {
          obj['PAID_RETURN_TIME'] = _LiveQueuePAIDRETURNTIME["default"].constructFromObject(data['PAID_RETURN_TIME']);
        }
        if (data.hasOwnProperty('BOARDING_GROUP')) {
          obj['BOARDING_GROUP'] = _LiveQueueBOARDINGGROUP["default"].constructFromObject(data['BOARDING_GROUP']);
        }
      }
      return obj;
    }
  }]);
  return LiveQueue;
}();
/**
 * @member {module:model/LiveQueueSTANDBY} STANDBY
 */
LiveQueue.prototype['STANDBY'] = undefined;

/**
 * @member {module:model/LiveQueueSTANDBY} SINGLE_RIDER
 */
LiveQueue.prototype['SINGLE_RIDER'] = undefined;

/**
 * @member {module:model/LiveQueueRETURNTIME} RETURN_TIME
 */
LiveQueue.prototype['RETURN_TIME'] = undefined;

/**
 * @member {module:model/LiveQueuePAIDRETURNTIME} PAID_RETURN_TIME
 */
LiveQueue.prototype['PAID_RETURN_TIME'] = undefined;

/**
 * @member {module:model/LiveQueueBOARDINGGROUP} BOARDING_GROUP
 */
LiveQueue.prototype['BOARDING_GROUP'] = undefined;
var _default = LiveQueue;
exports["default"] = _default;