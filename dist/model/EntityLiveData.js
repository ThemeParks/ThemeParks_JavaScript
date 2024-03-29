"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _ApiClient = _interopRequireDefault(require("../ApiClient"));
var _DiningAvailability = _interopRequireDefault(require("./DiningAvailability"));
var _EntityType = _interopRequireDefault(require("./EntityType"));
var _LiveQueue = _interopRequireDefault(require("./LiveQueue"));
var _LiveShowTime = _interopRequireDefault(require("./LiveShowTime"));
var _LiveStatusType = _interopRequireDefault(require("./LiveStatusType"));
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
 * The EntityLiveData model module.
 * @module model/EntityLiveData
 * @version 6.0.1
 */
var EntityLiveData = /*#__PURE__*/function () {
  /**
   * Constructs a new <code>EntityLiveData</code>.
   * @alias module:model/EntityLiveData
   * @param id {String} 
   * @param name {String} 
   * @param entityType {module:model/EntityType} 
   * @param lastUpdated {Date} 
   */
  function EntityLiveData(id, name, entityType, lastUpdated) {
    _classCallCheck(this, EntityLiveData);
    EntityLiveData.initialize(this, id, name, entityType, lastUpdated);
  }

  /**
   * Initializes the fields of this object.
   * This method is used by the constructors of any subclasses, in order to implement multiple inheritance (mix-ins).
   * Only for internal use.
   */
  _createClass(EntityLiveData, null, [{
    key: "initialize",
    value: function initialize(obj, id, name, entityType, lastUpdated) {
      obj['id'] = id;
      obj['name'] = name;
      obj['entityType'] = entityType;
      obj['lastUpdated'] = lastUpdated;
    }

    /**
     * Constructs a <code>EntityLiveData</code> from a plain JavaScript object, optionally creating a new instance.
     * Copies all relevant properties from <code>data</code> to <code>obj</code> if supplied or a new instance if not.
     * @param {Object} data The plain JavaScript object bearing properties of interest.
     * @param {module:model/EntityLiveData} obj Optional instance to populate.
     * @return {module:model/EntityLiveData} The populated <code>EntityLiveData</code> instance.
     */
  }, {
    key: "constructFromObject",
    value: function constructFromObject(data, obj) {
      if (data) {
        obj = obj || new EntityLiveData();
        if (data.hasOwnProperty('id')) {
          obj['id'] = _ApiClient["default"].convertToType(data['id'], 'String');
        }
        if (data.hasOwnProperty('name')) {
          obj['name'] = _ApiClient["default"].convertToType(data['name'], 'String');
        }
        if (data.hasOwnProperty('entityType')) {
          obj['entityType'] = _EntityType["default"].constructFromObject(data['entityType']);
        }
        if (data.hasOwnProperty('status')) {
          obj['status'] = _LiveStatusType["default"].constructFromObject(data['status']);
        }
        if (data.hasOwnProperty('lastUpdated')) {
          obj['lastUpdated'] = _ApiClient["default"].convertToType(data['lastUpdated'], 'Date');
        }
        if (data.hasOwnProperty('queue')) {
          obj['queue'] = _LiveQueue["default"].constructFromObject(data['queue']);
        }
        if (data.hasOwnProperty('showtimes')) {
          obj['showtimes'] = _ApiClient["default"].convertToType(data['showtimes'], [_LiveShowTime["default"]]);
        }
        if (data.hasOwnProperty('operatingHours')) {
          obj['operatingHours'] = _ApiClient["default"].convertToType(data['operatingHours'], [_LiveShowTime["default"]]);
        }
        if (data.hasOwnProperty('diningAvailability')) {
          obj['diningAvailability'] = _ApiClient["default"].convertToType(data['diningAvailability'], [_DiningAvailability["default"]]);
        }
      }
      return obj;
    }
  }]);
  return EntityLiveData;
}();
/**
 * @member {String} id
 */
EntityLiveData.prototype['id'] = undefined;

/**
 * @member {String} name
 */
EntityLiveData.prototype['name'] = undefined;

/**
 * @member {module:model/EntityType} entityType
 */
EntityLiveData.prototype['entityType'] = undefined;

/**
 * @member {module:model/LiveStatusType} status
 */
EntityLiveData.prototype['status'] = undefined;

/**
 * @member {Date} lastUpdated
 */
EntityLiveData.prototype['lastUpdated'] = undefined;

/**
 * @member {module:model/LiveQueue} queue
 */
EntityLiveData.prototype['queue'] = undefined;

/**
 * @member {Array.<module:model/LiveShowTime>} showtimes
 */
EntityLiveData.prototype['showtimes'] = undefined;

/**
 * @member {Array.<module:model/LiveShowTime>} operatingHours
 */
EntityLiveData.prototype['operatingHours'] = undefined;

/**
 * @member {Array.<module:model/DiningAvailability>} diningAvailability
 */
EntityLiveData.prototype['diningAvailability'] = undefined;
var _default = EntityLiveData;
exports["default"] = _default;