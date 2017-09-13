'use strict';

(function () {
    angular.module('m-grid', [
        'm-grid.config',
        'm-grid.directive',
        'm-grid.service',
        'm-grid.pagination',
        'm-grid.start-from.filter',
        'm-grid.progress-circular.direcitve'
    ]);

    angular.module('m-grid.config', [])

    .provider('mGridConfig', function () {
        var config = {
            tableClass: 'table table-striped table-bordered m-grid-table',
            thClass: 'm-grid-th',
            footerClass: 'm-grid-footer',
            defaultPageLimit: 10,
            displayLimitOptions: [
                { 'text': 10, 'value': 10 },
                { 'text': 20, 'value': 20 },
                { 'text': 50, 'value': 50 },
                { 'text': 100, 'value': 100 }
            ]
        };

        this.setDefaultPageLimit = function (limit) {
            config.defaultPageLimit = limit || 10;
        };

        this.setDisplayLimitOptions = function (limitOptions) {
            if (!angular.isArray(limitOptions)) {
                throw new Error('param limitOptions should be array');
            }

            if (limitOptions.length === 0) {
                throw new Error('param limitOptions should have at least one record');
            }

            config.displayLimitOptions = [];
            limitOptions.forEach(function (item) {
                if (angular.isObject(item)) {
                    config.displayLimitOptions.push({
                        text: item.text,
                        value: item.value
                    });
                } else {
                    config.displayLimitOptions.push({
                        text: item,
                        value: +item
                    });
                }
            });
        };

        this.setCssClass = function (classObj) {
            if (!angular.isObject(classObj)) {
                throw new Error('param classObj should be a object');
            }
            if (classObj.hasOwnProperty('table')) {
                config.tableClass = classObj.table;
            }
            if (classObj.hasOwnProperty('th')) {
                config.thClass = classObj.th;
            }
            if (classObj.hasOwnProperty('footer')) {
                config.footerClass = classObj.footer;
            }
        };

        this.appendCssClass = function (classObj) {
            if (!angular.isObject(classObj)) {
                throw new Error('param classObj should be a object');
            }
            if (classObj.hasOwnProperty('table')) {
                config.tableClass += ' ' + classObj.table;
            }
            if (classObj.hasOwnProperty('th')) {
                config.thClass += ' ' + classObj.th;
            }
            if (classObj.hasOwnProperty('footer')) {
                config.footerClass += ' ' + classObj.footer;
            }
        };

        this.$get = [function () {
            return config;
        }];
    });

    angular.module('m-grid.directive', ['m-grid.config'])

    .directive('mGrid', ['$log', '$compile', '$filter', '$timeout', '$http', '$q', 'mGridConfig', 'mGridService', function ($log, $compile, $filter, $timeout, $http, $q, mGridConfig, mGridService) {
        /**
         * Link function for directive
         * @param {*} scope
         * @param {*} element
         * @param {*} attr
         */
        function linkFn ($scope, element, attr) {
            // Handle undefined gridOptions
            if (!$scope.gridOptions) {
                throw new Error('mGrid must configure gridOptions and there columns');
            }

            // local variables
            var searchTimer;
            var globalSearch = $scope.gridOptions.globalSearch || mGridConfig.globalSearch || 'globalSearch';
            var globalSearchListener;
            var enableWatchEvent = false;
            var forceApplyPromise;
            var oldDisplayLimit = ($scope.gridOptions.config || {}).defaultPageLimit || mGridConfig.defaultPageLimit;

            // local scope variables
            $scope.predicate = '';
            $scope.reverse = false;
            $scope.displayLimitOptions = mGridConfig.displayLimitOptions;

            // pagination option
            $scope.startFrom = 0;
            $scope.currentPage = 1;
            $scope.displayLimit = ($scope.gridOptions.config || {}).defaultPageLimit || mGridConfig.defaultPageLimit;

            // options for async loading data
            $scope.gridData = {
                data: [], // data
                total: 0, // total record
                loading: false, // is we are fetching data from xhr request
                loadingFull: false, // only fetching a page. We show a small loding image in side of pagination control if we are not loading full
                firstLoaded: false
            };

            /***********************************************
             * Initilization
             **********************************************/

            if ($scope.gridOptions.enableSearch) {
                // watch for search only if we want to enable search
                // increasing watcher decrease performance
                // we only use watcher if we need
                globalSearchListener = $scope.$on(globalSearch, function (event, value) {
                    _search(value);
                });

                var gridSearchWatch = $scope.$watch('gridOptions.search', function (newValue, oldValue) {
                    _search(newValue);
                });
            }

            var displayLimitWatch = $scope.$watch('displayLimit', function () {
                $scope.gridData.loadingFull = false;

                if (enableWatchEvent && oldDisplayLimit !== $scope.displayLimit) {
                    oldDisplayLimit = $scope.displayLimit;
                    if ($scope.gridOptions.async) {
                        _refreshAsyncData();
                    }
                }
            });

            $scope.$on('$destroy', function () {
                if ($scope.gridOptions.enableSearch) {
                    globalSearchListener();
                    gridSearchWatch();
                }

                displayLimitWatch();
            });

            // compile html
            (function () {
                var html = mGridService.getGridTemplate($scope.gridOptions, mGridConfig);

                element.html(html);

                $compile(element.contents())($scope);
            })();

            /***********************************************
             * Scope functions
             **********************************************/

            // make a external scope
            // it will retrun a object from `$parent` scope.
            // default it take `states` obejct from `$parent` scope
            $scope.getExternalScope = function () {
                return $scope.$parent[$scope.gridOptions.externalScope || 'states'] || {};
            };

            /**
             * Set order predicate
             */
            $scope.order = function (predicate, sorting) {
                if (!sorting) {
                    return;
                }

                $scope.reverse = ($scope.predicate === predicate) ? !$scope.reverse : false;
                $scope.predicate = predicate;

                $scope.currentPage = 1;
                $scope.currentPageChange();
            };

            // get conditionaly page count
            $scope.getRecordCount = function () {
                if ($scope.gridOptions.async) {
                    return $scope.gridData.total || 0;
                }

                var data = $scope.gridOptions.data || [];

                if ($scope.gridOptions.enableSearch === true) {
                    data = _getFilteredData(data, $scope.search);
                }

                return data.length;
            };

            // get conditionaly data
            $scope.getData = function () {
                if ($scope.gridOptions.async) {
                    return $scope.gridData.data || [];
                }

                var data = $scope.gridOptions.data || [];

                if ($scope.gridOptions.enableSearch === true) {
                    data = _getFilteredData(data, $scope.search);
                }

                if ($scope.predicate) {
                    data = _getSortedData(data, $scope.predicate, $scope.reverse);
                }

                if ($scope.gridOptions.disablePagination !== true) {
                    data = _getSkippedData(data, $scope.startFrom);
                    data = _getLimitedData(data, $scope.displayLimit);
                }

                return data;
            };

            // refresh data on page change
            $scope.currentPageChange = function () {
                $scope.startFrom = ($scope.currentPage - 1) * $scope.displayLimit;

                if (enableWatchEvent && $scope.gridOptions.async) {
                    $scope.gridData.loadingFull = false;
                    $scope.gridData.loading = true;

                    var options = _asyncOptions();

                    $scope.asyncData(options).then(function (data) {
                        $scope.gridData.data = $scope.gridOptions.data = data;
                        $scope.gridData.loading = false;
                        $scope.gridData.firstLoaded = true;
                        _forceApply();
                    }, function (error) {
                        $scope.gridData.loading = false;
                        $scope.gridData.firstLoaded = true;
                        $log.error(error);
                    });
                }
            };

            // get status string
            $scope.getStatusString = function () {
                // 1 - 10 of 327 items
                var len = $scope.getRecordCount();

                return ($scope.startFrom + 1) + ' - ' + Math.min(($scope.startFrom + $scope.displayLimit), len) + ' of ' + len + ' items';
            };

            /**
             * Recompile grid when some column level property change
             * @param {Boolean} force flag for recompile force fully grid
             */
            $scope.recompile = function (force) {
                if (force) {
                    var html = mGridService.getGridTemplate($scope.gridOptions, mGridConfig);
                    element.html(html);
                    $compile(element.contents())($scope);
                } else {
                    var tbody = element.find('tbody');
                    tbody.html(mGridService.getBodyTemplate($scope.gridOptions, mGridConfig));
                    $compile(tbody.contents())($scope);
                }
            };

            /***********************************************
             * Helper functions
             **********************************************/

            /**
             * Update search term
             */
            var _search = function (value) {
                $timeout.cancel(searchTimer);

                // search on finish typing
                searchTimer = $timeout(function () {
                    if ($scope.search !== value) {
                        $scope.startFrom = 0;
                        $scope.currentPage = 1;
                        $scope.search = value;
                        if ($scope.gridOptions.async) {
                            _refreshAsyncData();
                        }
                    }
                }, 1000);
            };

            /**
             * Get sorted data
             * @return {any[]}
             */
            var _getSortedData = function (data, predicate, reverse) {
                return $filter('orderBy')(data, predicate, reverse);
            };

            var _getSkippedData = function (data, skip) {
                return $filter('mGridStartFrom')(data, skip);
            };

            var _getLimitedData = function (data, limit) {
                return $filter('limitTo')(data, limit);
            };

            var _getFilteredData = function (data, search) {
                return $filter('filter')(data, search);
            };

            /**
             * Create async data fetcher function
             * @param {String} url
             */
            var _asyncRequest = function (url) {
                return function (options) {
                    var _url = url;
                    angular.forEach(options, function (value, key) {
                        if (angular.isUndefined(value)) {
                            value = '';
                        }
                        _url = _url.replace('{' + key + '}', value);
                    });

                    return $http.get(_url)
                        .then(function (res) {
                            return res.data;
                        }).catch(function (res) {
                            return $q.reject(res.data);
                        });
                };
            };

            var _initAsync = function () {
                if (
                    (typeof $scope.gridOptions.asyncData !== 'function' && typeof $scope.gridOptions.asyncData !== 'string') ||
                    (typeof $scope.gridOptions.asyncDataCount !== 'function' && typeof $scope.gridOptions.asyncDataCount !== 'string')
                 ) {
                    throw new Error('asyncData and asyncCount must a function or string');
                }

                if (typeof $scope.gridOptions.asyncData === 'function') {
                    $scope.asyncData = $scope.gridOptions.asyncData;
                } else {
                    $scope.asyncData = _asyncRequest($scope.gridOptions.asyncData);
                }

                if (typeof $scope.gridOptions.asyncDataCount === 'function') {
                    $scope.asyncDataCount = $scope.gridOptions.asyncDataCount;
                } else {
                    $scope.asyncDataCount = _asyncRequest($scope.gridOptions.asyncDataCount);
                }
            };

            var _asyncOptions = function () {
                var orderby = '';
                if ($scope.predicate) {
                    orderby = ($scope.reverse ? '-' : '') + $scope.predicate;
                }

                var options = {};

                if ($scope.gridOptions.urlParams && angular.isObject($scope.gridOptions.urlParams)) {
                    for (var key in $scope.gridOptions.urlParams) {
                        options[key] = $scope.gridOptions.urlParams[key];
                    }
                }

                angular.extend(options, {
                    term: $scope.search,
                    orderby: orderby,
                    skip: $scope.startFrom,
                    take: $scope.displayLimit,
                    page: $scope.currentPage,
                    limit: $scope.displayLimit
                });

                return options;
            };

            var _refreshAsyncData = function () {
                $scope.currentPage = 1;

                var options = _asyncOptions();

                $scope.gridData.loading = true;
                $scope.gridData.loadingFull = true;
                $scope.asyncDataCount(options).then(function (count) {
                    $scope.gridData.total = count;
                    _forceApply();

                    $scope.asyncData(options).then(function (data) {
                        $scope.gridData.data = $scope.gridOptions.data = data;
                        $scope.gridData.loading = false;
                        $scope.gridData.firstLoaded = true;
                        $scope.gridData.loadingFull = false;
                        _forceApply();
                    }, function (error) {
                        $scope.gridData.loading = false;
                        $scope.gridData.firstLoaded = true;
                        $scope.gridData.loadingFull = false;
                        $log.error(error);
                    });
                }, function (error) {
                    $scope.gridData.loading = false;
                    $scope.gridData.loadingFull = false;
                    $log.error(error);
                });
            };

            var _forceApply = function () {
                if (forceApplyPromise !== undefined) {
                    return;
                }

                forceApplyPromise = $timeout(function () {
                    forceApplyPromise = undefined;
                    if (!$scope.$$phase) {
                        $scope.$apply();
                    } else {
                        _forceApply();
                    }
                }, 500);
            };

            /***********************************************
             * Export methods
             **********************************************/

            $scope.gridOptions.refresh = $scope.recompile;  // refresh grid

            /***********************************************
             * Final execution
             **********************************************/

            // set default order by
            if ($scope.gridOptions.defaultSorting) {
                var _fieldname = $scope.gridOptions.defaultSorting;

                if (_fieldname.indexOf('-') === 0) { // reverse sorting
                    _fieldname = _fieldname.substring(1);
                    $scope.predicate = _fieldname;
                }

                $scope.order(_fieldname, true);
            }

            // async data
            if ($scope.gridOptions.async) {
                _initAsync();
                _refreshAsyncData();
            }

            enableWatchEvent = true;
        }

        return {
            scope: {
                gridOptions: '='
            },
            replace: true,
            restrict: 'E',
            template: '<div class="m-grid"></div>',
            link: linkFn
        };
    }]);

    angular.module('m-grid.pagination', ['m-grid.config'])

    /**
     * Helper internal service for generating common controller code between the
     * pager and pagination components
     */
    .factory('mGridPaging', ['$parse', function ($parse) {
        return {
            create: function (ctrl, $scope, $attrs) {
                ctrl.setNumPages = $attrs.numPages ? $parse($attrs.numPages).assign : angular.noop;
                ctrl.ngModelCtrl = { $setViewValue: angular.noop }; // nullModelCtrl
                ctrl._watchers = [];

                ctrl.init = function (ngModelCtrl, config) {
                    ctrl.ngModelCtrl = ngModelCtrl;
                    ctrl.config = config;

                    ngModelCtrl.$render = function () {
                        ctrl.render();
                    };

                    if ($attrs.itemsPerPage) {
                        ctrl._watchers.push($scope.$parent.$watch($attrs.itemsPerPage, function (value) {
                            ctrl.itemsPerPage = parseInt(value, 10);
                            $scope.totalPages = ctrl.calculateTotalPages();
                            ctrl.updatePage();
                        }));
                    } else {
                        ctrl.itemsPerPage = config.itemsPerPage;
                    }

                    $scope.$watch('totalItems', function (newTotal, oldTotal) {
                        if (angular.isDefined(newTotal) || newTotal !== oldTotal) {
                            $scope.totalPages = ctrl.calculateTotalPages();
                            ctrl.updatePage();
                        }
                    });
                };

                ctrl.calculateTotalPages = function () {
                    var totalPages = ctrl.itemsPerPage < 1 ? 1 : Math.ceil($scope.totalItems / ctrl.itemsPerPage);
                    return Math.max(totalPages || 0, 1);
                };

                ctrl.render = function () {
                    $scope.page = parseInt(ctrl.ngModelCtrl.$viewValue, 10) || 1;
                };

                $scope.selectPage = function (page, evt) {
                    if (evt) {
                        evt.preventDefault();
                    }

                    var clickAllowed = !$scope.ngDisabled || !evt;
                    if (clickAllowed && $scope.page !== page && page > 0 && page <= $scope.totalPages) {
                        if (evt && evt.target) {
                            evt.target.blur();
                        }
                        ctrl.ngModelCtrl.$setViewValue(page);
                        ctrl.ngModelCtrl.$render();
                    }
                };

                $scope.noPrevious = function () {
                    return $scope.page === 1;
                };

                $scope.noNext = function () {
                    return $scope.page === $scope.totalPages;
                };

                ctrl.updatePage = function () {
                    ctrl.setNumPages($scope.$parent, $scope.totalPages); // Readonly variable

                    if ($scope.page > $scope.totalPages) {
                        $scope.selectPage($scope.totalPages);
                    } else {
                        ctrl.ngModelCtrl.$render();
                    }
                };

                $scope.$on('$destroy', function () {
                    while (ctrl._watchers.length) {
                        ctrl._watchers.shift()();
                    }
                });
            }
        };
    }])

    .directive('mGridTabindexToggle', function () {
        return {
            restrict: 'A',
            link: function (scope, elem, attrs) {
                attrs.$observe('disabled', function (disabled) {
                    attrs.$set('tabindex', disabled ? -1 : null);
                });
            }
        };
    })

    .constant('mGridPaginationConfig', {
        itemsPerPage: 10,
        maxSize: 5
    })

    .controller('mGridPaginationController', ['$scope', '$attrs', '$parse', 'mGridPaging', 'mGridPaginationConfig', function ($scope, $attrs, $parse, mGridPaging, mGridPaginationConfig) {
        var ctrl = this;
        // Setup configuration parameters
        var maxSize = angular.isDefined($attrs.maxSize) ? $scope.$parent.$eval($attrs.maxSize) : mGridPaginationConfig.maxSize;
        var pageLabel = angular.identity;
        $attrs.$set('role', 'menu');

        mGridPaging.create(this, $scope, $attrs);

        if ($attrs.maxSize) {
            ctrl._watchers.push($scope.$parent.$watch($parse($attrs.maxSize), function (value) {
                maxSize = parseInt(value, 10);
                ctrl.render();
            }));
        }

        // Create page object used in template
        function makePage (number, text, isActive) {
            return {
                number: number,
                text: text,
                active: isActive
            };
        }

        function getPages (currentPage, totalPages) {
            var pages = [];

            // Default page limits
            var startPage = 1;
            var endPage = totalPages;
            var isMaxSized = angular.isDefined(maxSize) && maxSize < totalPages;

            // recompute if maxSize
            if (isMaxSized) {
                // Visible pages are paginated with maxSize
                startPage = (Math.ceil(currentPage / maxSize) - 1) * maxSize + 1;

                // Adjust last page if limit is exceeded
                endPage = Math.min(startPage + maxSize - 1, totalPages);
            }

            // Add page number links
            for (var number = startPage; number <= endPage; number++) {
                var page = makePage(number, pageLabel(number), number === currentPage);
                pages.push(page);
            }

            // Add links to move between page sets
            if (isMaxSized && maxSize > 0) {
                if (startPage > 1) {
                    var previousPageSet = makePage(startPage - 1, '...', false);
                    pages.unshift(previousPageSet);
                }

                if (endPage < totalPages) {
                    var nextPageSet = makePage(endPage + 1, '...', false);
                    pages.push(nextPageSet);
                }
            }
            return pages;
        }

        var originalRender = this.render;
        this.render = function () {
            originalRender();
            if ($scope.page > 0 && $scope.page <= $scope.totalPages) {
                $scope.pages = getPages($scope.page, $scope.totalPages);
            }
        };
    }])

    .directive('mGridPagination', ['$log', '$parse', 'mGridPaginationConfig', function ($log, $parse, mGridPaginationConfig) {
        return {
            scope: {
                totalItems: '=',
                ngDisabled: '='
            },
            require: ['mGridPagination', '?ngModel'],
            restrict: 'E',
            replace: true,
            controller: 'mGridPaginationController',
            controllerAs: 'pagination',
            template: '<ul class="pagination pagination-sm" style="margin: 0px;">' +
            '<li role="menuitem" ng-class="{disabled: noPrevious()||ngDisabled}" class="pagination-first"><a href ng-click="selectPage(1, $event)" ng-disabled="noPrevious()||ngDisabled" m-grid-tabindex-toggle>First</a></li>' +
            '<li role="menuitem" ng-repeat="page in pages track by $index" ng-class="{active: page.active,disabled: ngDisabled&&!page.active}" class="pagination-page"><a href ng-click="selectPage(page.number, $event)" ng-disabled="ngDisabled&&!page.active" m-grid-tabindex-toggle>{{page.text}}</a></li>' +
            '<li role="menuiem" ng-class="{disabled: noNext()||ngDisabled}" class="pagination-last"><a href ng-click="selectPage(totalPages, $event)" ng-disabled="noNext()||ngDisabled" m-grid-tabindex-toggle>Last</a></li>' +
            '</ul>',
            link: function (scope, element, attrs, ctrls) {
                element.addClass('pagination');
                var paginationCtrl = ctrls[0];
                var ngModelCtrl = ctrls[1];

                if (!ngModelCtrl) {
                    return; // do nothing if no ng-model
                }

                paginationCtrl.init(ngModelCtrl, mGridPaginationConfig);
            }
        };
    }]);

    angular.module('m-grid.service', [])

    .service('mGridService', ['$log', function ($log) {
        /**
         * Generate template for grid
         * @public
         * @param {*} gridOptions
         * @param {*} mGridConfig
         * @return {String} Grid template
         */
        function getGridTemplate (gridOptions, mGridConfig) {
            var html = '';

            html += '<div style="overflow-x:auto;width: 100%;">';
            html += '<table class="' + mGridConfig.tableClass + '">';
            html += '<thead>';
            html += '<tr>';
            html += '<th ng-repeat="column in gridOptions.columns" class="' + mGridConfig.thClass + '" ng-style="{\'width\':column.style.width||\'auto\',\'min-width\':column.style.minWidth||\'auto\',\'text-align\':column.style.textAlign||\'left\',\'display\':(column.style.visible!==false?\'table-cell\':\'none\')}">';
            html += '<a href="" ng-click="order(column.field, (column.sorting !== undefined ? column.sorting : gridOptions.sorting))" ng-bind="column.name">Name</a>';
            html += '<span class="m-grid-sortorder" ng-show="predicate === column.field" ng-class="{\'m-grid-sortorder-reverse\':reverse}"></span>';
            html += '</th>';
            html += '</tr>';
            html += '</thead>';
            html += '<tbody ng-hide="gridData.loading && gridData.loadingFull">';
            html += getBodyTemplate(gridOptions);
            html += '</tbody>';
            html += '<tbody>';
            html += '<tr ng-show="gridOptions.async && ((gridData.loading && gridData.loadingFull) || !gridData.firstLoaded)"><td colspan="' + gridOptions.columns.length + '" style="text-align:center; margin: 20px auto 10px;"><progress-circular></progress-circular></td></tr>';
            html += '</tbody>';
            html += '</table>';

            if (gridOptions.disablePagination !== true) {
                html += getPaginationTemplate(gridOptions, mGridConfig);
            }

            html += '</div>';

            return html;
        }

        /**
         * Generate template for cell
         * @private
         * @param {*} column
         * @return {String} Cell template
         */
        function getCellTemplate (column, rowItemAlias) {
            var cellStyle = '';

            if (column.style) {
                var style = column.style;
                cellStyle = ' ng-style="{\'text-align\':\'' + (style.textAlign || 'left') + '\',\'display\':' + (style.visible !== false ? '\'table-cell\'' : '\'none\'') + '}"';
            }

            var cellTemplate = '<td' + cellStyle + '>';

            if (column.cellTemplate) {
                if (rowItemAlias) {
                    cellTemplate += '<div ng-init="' + rowItemAlias + '=item">' + column.cellTemplate + '</div>';
                } else {
                    cellTemplate += '<div>' + column.cellTemplate + '</div>';
                }
            } else {
                cellTemplate += '<span ng-bind="item[\'' + column.field + '\']' + (column.format ? ' | ' + column.format : '') + '"></span>';
            }

            cellTemplate += '</td>';

            return cellTemplate;
        }

        /**
         * Generate <tbody> template
         * @param {*} gridOptions
         * @return {String} <tbody> template
         */
        function getBodyTemplate (gridOptions, mGridConfig) {
            var bodyTemplate = '';

            bodyTemplate += '<tr ng-repeat="item in getData()">';

            angular.forEach(gridOptions.columns, function (item) {
                bodyTemplate += getCellTemplate(item, gridOptions.rowItemAlias);
            });

            bodyTemplate += '</tr>';

            // bodyTemplate += '<tr><td colspan="3"><pre>{{ {total: gridData.total, loading: gridData.loading, loadingFull: gridData.loadingFull, firstLoaded: gridData.firstLoaded} |json}}</pre></td></tr>';

            bodyTemplate += '<tr ng-show="getRecordCount() == 0 && (!gridOptions.async || gridData.firstLoaded)"><td colspan="' + gridOptions.columns.length + '"><div style="text-align:center; margin: 20px auto 20px;"><h3>No record found</h3></div></td></tr>';

            return bodyTemplate;
        }

        /**
         * Generate pagination template
         * @param {*} gridOptions
         * @param {*} mGridConfig
         * @return {String} pagination template
         */
        function getPaginationTemplate (gridOptions, mGridConfig) {
            var html = '';
            html += '<div ng-hide="getRecordCount() == 0 || (gridData.loading && gridData.loadingFull)" class="panel-footer ' + mGridConfig.footerClass + '">';
            html += '<m-grid-pagination class="pull-left" style="margin: 0px;" total-items="getRecordCount()" max-size="3" ng-model="currentPage" items-per-page="displayLimit" rotate="false" ng-change="currentPageChange()"></m-grid-pagination>';
            html += '<div class="pull-left" style=" margin-left: 10px;">';
            html += '<select class="form-control input-sm hidden-xs" style="display:inline-block; width: 70px; height: 29px;" type="text" ng-model="displayLimit" ng-options="o.value as o.text for o in displayLimitOptions"></select>';
            html += '<span class="hidden-xs"> items per page</span>';
            html += '<span ng-if="gridData.loading && !gridData.loadingFull && gridData.firstLoaded" style="display:inline-block; vertical-align: middle; margin-left: 10px; height:22px;">';
            html += '<progress-circular size="sm"></progress-circular>';
            html += '</span>';
            html += '</div>';
            html += '<div class="pull-right hidden-xs" ng-bind="getStatusString()" style="margin-top:5px;"></div>';
            html += '<div class="clearfix"></div>';
            html += '</div>';
            return html;
        }

        return {
            getGridTemplate: getGridTemplate,
            getCellTemplate: getCellTemplate,
            getBodyTemplate: getBodyTemplate,
            getPaginationTemplate: getPaginationTemplate
        };
    }]);

    angular.module('m-grid.start-from.filter', [])

    .filter('mGridStartFrom', function () {
        // We already have a limitTo filter built-in to angular,
        // let's make a startFrom filter
        return function (input, start) {
            if (!angular.isArray(input)) {
                return input;
            }

            start = +start; // parse to int
            return input.slice(start);
        };
    });

    angular.module('m-grid.progress-circular.direcitve', [])

    .directive('progressCircular', ['$compile', function ($compile) {
        return {
            restrict: 'EA',
            scope: {
                size: '@'
            },
            replace: true,
            template: '<span></span>',
            link: function ($scope, element) {
                var cx = 50;
                var cy = 50;
                var r = 20;
                var animateClass = 'm-grid-progress-dash';
                var strokeWidth = 3;

                var width = 100;
                var height = 100;

                if ($scope.size === 'sm') {
                    cx = 11;
                    cy = 11;
                    r = 10;
                    animateClass = 'm-grid-progress-dash-sm';

                    width = 22;
                    height = 22;
                    strokeWidth = 2;
                }

                var html = '<svg style="animation: m-grid-progress-rotate 2s linear infinite; height: ' + height + 'px; width: ' + width + 'px; position: relative">' +
                        '<circle style="animation:' + animateClass + ' 1.5s ease-in-out infinite, m-grid-progress-color 6s ease-in-out infinite" cx="' + cx + '" cy="' + cy + '" r="' + r + '" stroke-dasharray="1,200" stroke-dashoffset="0" stroke-linecap="round" fill="none" stroke-width="' + strokeWidth + '" stroke-miterlimit="10"/>' +
                        '</svg>';
                element.html(html);
                var c = $compile(html)($scope);
                element.replaceWith(c);
            }
        };
    }]);
})();