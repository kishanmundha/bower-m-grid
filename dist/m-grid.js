'use strict';

(function () {
    angular.module('m-grid', ['m-grid.config', 'm-grid.directive', 'm-grid.service', 'm-grid.pagination', 'm-grid.start-from.filter']);

    angular.module('m-grid.config', [])

    .constant('mGridConfig', {
        tableClass: 'table table-striped table-bordered m-grid-table',
        thClass: 'm-grid-th',
        footerClass: 'm-grid-footer',
        displayLimitOptions: [
            { 'text': 10, 'value': 10 },
            { 'text': 20, 'value': 20 },
            { 'text': 50, 'value': 50 },
            { 'text': 100, 'value': 100 }
        ]
    });

    angular.module('m-grid.directive', ['m-grid.config'])

    .directive('mGrid', ['$log', '$compile', '$filter', '$timeout', 'mGridConfig', 'mGridService', function ($log, $compile, $filter, $timeout, mGridConfig, mGridService) {
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

            // local scope variables
            $scope.predicate = '';
            $scope.reverse = false;
            $scope.displayLimitOptions = mGridConfig.displayLimitOptions;

            // pagination option
            $scope.startFrom = 0;
            $scope.currentPage = 1;
            $scope.displayLimit = 10;

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

            $scope.$on('$destroy', function () {
                if ($scope.gridOptions.enableSearch) {
                    globalSearchListener();
                    gridSearchWatch();
                }
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
                var data = $scope.gridOptions.data || [];

                if ($scope.gridOptions.enableSearch === true) {
                    data = _getFilteredData(data, $scope.search);
                }

                return data.length;
            };

            // get conditionaly data
            $scope.getData = function () {
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

            $scope.currentPageChange = function () {
                $scope.startFrom = ($scope.currentPage - 1) * $scope.displayLimit;
            };

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
                        $scope.search = value;
                        // refreshAjaxData();
                    }
                }, 500);
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
            html += '<tbody>';
            html += getBodyTemplate(gridOptions);
            html += '</tbody>';
            html += '</thead>';
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
        function getCellTemplate (column) {
            var cellStyle = '';

            if (column.style) {
                var style = column.style;
                cellStyle = ' ng-style="{\'text-align\':\'' + (style.textAlign || 'left') + '\',\'display\':' + (style.visible !== false ? '\'table-cell\'' : '\'none\'') + '}"';
            }

            var cellTemplate = '<td' + cellStyle + '>';

            if (column.cellTemplate) {
                cellTemplate += '<div ng-init="row={\'entity\':item}">' + column.cellTemplate + '</div>';
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
                bodyTemplate += getCellTemplate(item);
            });

            bodyTemplate += '</tr>';

            bodyTemplate += '<tr ng-show="getRecordCount() == 0"><td colspan="' + gridOptions.columns.length + '"><div style="text-align:center; margin: 20px auto 20px;"><h3>No record found</h3></div></td></tr>';

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
            html += '<div ng-hide="getRecordCount() == 0" class="panel-footer ' + mGridConfig.footerClass + '">';
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
})();