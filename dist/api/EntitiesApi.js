"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _ApiClient = _interopRequireDefault(require("../ApiClient"));
var _EntityChildrenResponse = _interopRequireDefault(require("../model/EntityChildrenResponse"));
var _EntityData = _interopRequireDefault(require("../model/EntityData"));
var _EntityLiveDataResponse = _interopRequireDefault(require("../model/EntityLiveDataResponse"));
var _EntityScheduleResponse = _interopRequireDefault(require("../model/EntityScheduleResponse"));
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
* Entities service.
* @module api/EntitiesApi
* @version 6.0.1
*/
var EntitiesApi = /*#__PURE__*/function () {
  /**
  * Constructs a new EntitiesApi. 
  * @alias module:api/EntitiesApi
  * @class
  * @param {module:ApiClient} [apiClient] Optional API client implementation to use,
  * default to {@link module:ApiClient#instance} if unspecified.
  */
  function EntitiesApi(apiClient) {
    _classCallCheck(this, EntitiesApi);
    this.apiClient = apiClient || _ApiClient["default"].instance;
  }

  /**
   * Get entity document
   * Get the full data document for a given entity. You can supply either a GUID or slug string.
   * @param {String} entityID Entity ID (or slug) to fetch
   * @return {Promise} a {@link https://www.promisejs.org/|Promise}, with an object containing data of type {@link module:model/EntityData} and HTTP response
   */
  _createClass(EntitiesApi, [{
    key: "getEntityWithHttpInfo",
    value: function getEntityWithHttpInfo(entityID) {
      var postBody = null;
      // verify the required parameter 'entityID' is set
      if (entityID === undefined || entityID === null) {
        throw new Error("Missing the required parameter 'entityID' when calling getEntity");
      }
      var pathParams = {
        'entityID': entityID
      };
      var queryParams = {};
      var headerParams = {};
      var formParams = {};
      var authNames = [];
      var contentTypes = [];
      var accepts = ['application/json'];
      var returnType = _EntityData["default"];
      return this.apiClient.callApi('/entity/{entityID}', 'GET', pathParams, queryParams, headerParams, formParams, postBody, authNames, contentTypes, accepts, returnType, null);
    }

    /**
     * Get entity document
     * Get the full data document for a given entity. You can supply either a GUID or slug string.
     * @param {String} entityID Entity ID (or slug) to fetch
     * @return {Promise} a {@link https://www.promisejs.org/|Promise}, with data of type {@link module:model/EntityData}
     */
  }, {
    key: "getEntity",
    value: function getEntity(entityID) {
      return this.getEntityWithHttpInfo(entityID).then(function (response_and_data) {
        return response_and_data.data;
      });
    }

    /**
     * Get all children for a given entity document
     * Fetch a list of all the children that belong to this entity. This is recursive, so a destination will return all parks and all rides within those parks.
     * @param {String} entityID Entity ID (or slug) to fetch
     * @return {Promise} a {@link https://www.promisejs.org/|Promise}, with an object containing data of type {@link module:model/EntityChildrenResponse} and HTTP response
     */
  }, {
    key: "getEntityChildrenWithHttpInfo",
    value: function getEntityChildrenWithHttpInfo(entityID) {
      var postBody = null;
      // verify the required parameter 'entityID' is set
      if (entityID === undefined || entityID === null) {
        throw new Error("Missing the required parameter 'entityID' when calling getEntityChildren");
      }
      var pathParams = {
        'entityID': entityID
      };
      var queryParams = {};
      var headerParams = {};
      var formParams = {};
      var authNames = [];
      var contentTypes = [];
      var accepts = ['application/json'];
      var returnType = _EntityChildrenResponse["default"];
      return this.apiClient.callApi('/entity/{entityID}/children', 'GET', pathParams, queryParams, headerParams, formParams, postBody, authNames, contentTypes, accepts, returnType, null);
    }

    /**
     * Get all children for a given entity document
     * Fetch a list of all the children that belong to this entity. This is recursive, so a destination will return all parks and all rides within those parks.
     * @param {String} entityID Entity ID (or slug) to fetch
     * @return {Promise} a {@link https://www.promisejs.org/|Promise}, with data of type {@link module:model/EntityChildrenResponse}
     */
  }, {
    key: "getEntityChildren",
    value: function getEntityChildren(entityID) {
      return this.getEntityChildrenWithHttpInfo(entityID).then(function (response_and_data) {
        return response_and_data.data;
      });
    }

    /**
     * Get live data for this entity and any child entities
     * Fetch this entity's live data (queue times, parade times, etc.) as well as all child entities. For a destination, this will include all parks within that destination.
     * @param {String} entityID Entity ID (or slug) to fetch
     * @return {Promise} a {@link https://www.promisejs.org/|Promise}, with an object containing data of type {@link module:model/EntityLiveDataResponse} and HTTP response
     */
  }, {
    key: "getEntityLiveDataWithHttpInfo",
    value: function getEntityLiveDataWithHttpInfo(entityID) {
      var postBody = null;
      // verify the required parameter 'entityID' is set
      if (entityID === undefined || entityID === null) {
        throw new Error("Missing the required parameter 'entityID' when calling getEntityLiveData");
      }
      var pathParams = {
        'entityID': entityID
      };
      var queryParams = {};
      var headerParams = {};
      var formParams = {};
      var authNames = [];
      var contentTypes = [];
      var accepts = ['application/json'];
      var returnType = _EntityLiveDataResponse["default"];
      return this.apiClient.callApi('/entity/{entityID}/live', 'GET', pathParams, queryParams, headerParams, formParams, postBody, authNames, contentTypes, accepts, returnType, null);
    }

    /**
     * Get live data for this entity and any child entities
     * Fetch this entity's live data (queue times, parade times, etc.) as well as all child entities. For a destination, this will include all parks within that destination.
     * @param {String} entityID Entity ID (or slug) to fetch
     * @return {Promise} a {@link https://www.promisejs.org/|Promise}, with data of type {@link module:model/EntityLiveDataResponse}
     */
  }, {
    key: "getEntityLiveData",
    value: function getEntityLiveData(entityID) {
      return this.getEntityLiveDataWithHttpInfo(entityID).then(function (response_and_data) {
        return response_and_data.data;
      });
    }

    /**
     * Get entity schedule
     * Fetch this entity's schedule for the next 30 days
     * @param {String} entityID Entity ID (or slug) to fetch
     * @return {Promise} a {@link https://www.promisejs.org/|Promise}, with an object containing data of type {@link module:model/EntityScheduleResponse} and HTTP response
     */
  }, {
    key: "getEntityScheduleUpcomingWithHttpInfo",
    value: function getEntityScheduleUpcomingWithHttpInfo(entityID) {
      var postBody = null;
      // verify the required parameter 'entityID' is set
      if (entityID === undefined || entityID === null) {
        throw new Error("Missing the required parameter 'entityID' when calling getEntityScheduleUpcoming");
      }
      var pathParams = {
        'entityID': entityID
      };
      var queryParams = {};
      var headerParams = {};
      var formParams = {};
      var authNames = [];
      var contentTypes = [];
      var accepts = ['application/json'];
      var returnType = _EntityScheduleResponse["default"];
      return this.apiClient.callApi('/entity/{entityID}/schedule', 'GET', pathParams, queryParams, headerParams, formParams, postBody, authNames, contentTypes, accepts, returnType, null);
    }

    /**
     * Get entity schedule
     * Fetch this entity's schedule for the next 30 days
     * @param {String} entityID Entity ID (or slug) to fetch
     * @return {Promise} a {@link https://www.promisejs.org/|Promise}, with data of type {@link module:model/EntityScheduleResponse}
     */
  }, {
    key: "getEntityScheduleUpcoming",
    value: function getEntityScheduleUpcoming(entityID) {
      return this.getEntityScheduleUpcomingWithHttpInfo(entityID).then(function (response_and_data) {
        return response_and_data.data;
      });
    }

    /**
     * Get entity schedule for a specific month and year
     * Fetch this entity's schedule for the supplied year and month
     * @param {String} entityID Entity ID (or slug) to fetch
     * @param {Number} year Schedule year to fetch
     * @param {Number} month Schedule month to fetch. Must be a two digit zero-padded month.
     * @return {Promise} a {@link https://www.promisejs.org/|Promise}, with an object containing data of type {@link module:model/EntityScheduleResponse} and HTTP response
     */
  }, {
    key: "getEntityScheduleYearMonthWithHttpInfo",
    value: function getEntityScheduleYearMonthWithHttpInfo(entityID, year, month) {
      var postBody = null;
      // verify the required parameter 'entityID' is set
      if (entityID === undefined || entityID === null) {
        throw new Error("Missing the required parameter 'entityID' when calling getEntityScheduleYearMonth");
      }
      // verify the required parameter 'year' is set
      if (year === undefined || year === null) {
        throw new Error("Missing the required parameter 'year' when calling getEntityScheduleYearMonth");
      }
      // verify the required parameter 'month' is set
      if (month === undefined || month === null) {
        throw new Error("Missing the required parameter 'month' when calling getEntityScheduleYearMonth");
      }
      var pathParams = {
        'entityID': entityID,
        'year': year,
        'month': month
      };
      var queryParams = {};
      var headerParams = {};
      var formParams = {};
      var authNames = [];
      var contentTypes = [];
      var accepts = ['application/json'];
      var returnType = _EntityScheduleResponse["default"];
      return this.apiClient.callApi('/entity/{entityID}/schedule/{year}/{month}', 'GET', pathParams, queryParams, headerParams, formParams, postBody, authNames, contentTypes, accepts, returnType, null);
    }

    /**
     * Get entity schedule for a specific month and year
     * Fetch this entity's schedule for the supplied year and month
     * @param {String} entityID Entity ID (or slug) to fetch
     * @param {Number} year Schedule year to fetch
     * @param {Number} month Schedule month to fetch. Must be a two digit zero-padded month.
     * @return {Promise} a {@link https://www.promisejs.org/|Promise}, with data of type {@link module:model/EntityScheduleResponse}
     */
  }, {
    key: "getEntityScheduleYearMonth",
    value: function getEntityScheduleYearMonth(entityID, year, month) {
      return this.getEntityScheduleYearMonthWithHttpInfo(entityID, year, month).then(function (response_and_data) {
        return response_and_data.data;
      });
    }
  }]);
  return EntitiesApi;
}();
exports["default"] = EntitiesApi;