// Description:
//   Report current work in progress on github projects.
//
// Dependencies:
//   githubot - see https://github.com/iangreenleaf/githubot
//   underscore
//
// Configuration
//   HUBOT_GITHUB_TOKEN=your github auth token
//   HUBOT_GITHUB_USER=default organization for github projects
//   HUBOT_GITHUB_WIP_LABEL=name of label for work in progress issues
//   HUBOT_GITHUB_REVIEW_LABEL=name of label for issues in review
//   HUBOT_GITHUB_WORKFLOW_LABELS=comma separated list of labels used for workflow (ex: Backlog, In Progress)
//
// Commands:
//   Hubot waffle board <user_or_organization>/<project> - query for recent project activity
//   Hubot waffle board <project> - query for recent project activity w/ default organization
//   Hubot waffle board <project> - query for recent project activity w/ default organization
//
// Author:
//   Ryan Sonnek

var githubAuthToken = process.env.HUBOT_GITHUB_TOKEN;
var defaultGithubOrganization = process.env.HUBOT_GITHUB_USER;
var wipLabel = process.env.HUBOT_GITHUB_WIP_LABEL;
var reviewLabel = process.env.HUBOT_GITHUB_REVIEW_LABEL;
var workflowLabels = (process.env.HUBOT_GITHUB_WORKFLOW_LABELS || '').split(',');

module.exports = function(robot) {
  var github = require('githubot')(robot);
  var _ = require('underscore');
  var moment = require('moment');

  function rejectPullRequests(issues) {
    var issuesWithoutPullRequests = _.filter(issues, function(issue) {
      return !issue.pull_request;
    });
    return issuesWithoutPullRequests;
  }

  // see https://developer.github.com/v3/issues/#list-issues
  function issueToString(issue) {
    var labels = _.reject(issue.labels, function(label) { return _.contains(workflowLabels, label.name) });
    var hashtags = _.map(labels, function(label) { return '#' + label.name; }).sort().join(' ');
    var lastUpdatedAt = moment(issue.closed_at || issue.updated_at);
    var daysSinceUpdated = moment().diff(lastUpdatedAt, 'days');
    var owner = issue.assignee || issue.user;

    var parts = [];
    parts.push('#' + issue.number);
    if (daysSinceUpdated > 0) {
      parts.push('[' + daysSinceUpdated + 'd]');
    }
    parts.push('@' + owner.login);
    parts.push(issue.title);
    parts.push(hashtags);
    return parts.join(' ');
  }

  // see https://developer.github.com/v3/issues/#list-issues
  function inProgressReport(orgProject, callback) {
    github.get('/repos/' + orgProject + '/issues?filter=all&labels=' + wipLabel + '&sort=updated&direction=asc', function(issues) {
      var issuesWithoutPullRequests = rejectPullRequests(issues);
      printIssues('in progress issues', issuesWithoutPullRequests, orgProject, callback);
    });
  }

  // see https://developer.github.com/v3/issues/#list-issues
  function inReviewReport(orgProject, callback) {
    github.get('/repos/' + orgProject + '/issues?filter=all&labels=' + reviewLabel + '&sort=updated&direction=asc', function(issues) {
      var issuesWithoutPullRequests = rejectPullRequests(issues);
      printIssues('issues in review', issuesWithoutPullRequests, orgProject, callback);
    });
  }

  // see http://stackoverflow.com/questions/1296358/subtract-days-from-a-date-in-javascript
  function lastWeek() {
    var date = new Date();
    date.setDate(date.getDate() - 7);
    return date;
  }

  function printIssues(label, issues, orgProject, callback) {
    if (issues.length === 0) {
      callback('No ' + label + ' were found for ' + orgProject);
    } else {
      var message = 'These ' + label + ' were found for ' + orgProject + ':';
      issues.forEach(function(issue) {
        message += "\n* " + issueToString(issue);
      });
      callback(message);
    }
  }

  // list recently closed issues (in the past week)
  // see https://developer.github.com/v3/issues/#list-issues
  function recentClosedIssuesReport(orgProject, callback) {
    github.get('/repos/' + orgProject + '/issues?filter=all&state=closed&sort=updated&direction=desc&per_page=10&since=' + lastWeek().toISOString(), function(issues) {
      var issuesWithoutPullRequests = rejectPullRequests(issues);
      printIssues('recently closed issues', issuesWithoutPullRequests, orgProject, callback);
    });
  }

  // see https://developer.github.com/v3/search/#search-issues
  // example query: -label:"2 - Working" -label:"1 - Ready" -label:"0 - Backlog" repo:betterup/myproject is:open type:issue
  function inboxIssues(orgProject, callback) {
    var queryParts = [
      'type:issue',
      'is:open'
    ];
    queryParts.push('repo:' + orgProject);
    workflowLabels.forEach(function(label) {
      queryParts.push('-label:"' + label + '"');
    });
    github.get('/search/issues?sort=created&order=asc&q=' + queryParts.join(' '), function(results) {
      var issues = results.items;
      printIssues('new issues', issues, orgProject, callback);
    });
  }

  // see https://developer.github.com/v3/pulls/#list-pull-requests
  function openPullRequests(orgProject, callback) {
    github.get('/repos/' + orgProject + '/pulls?sort=updated&direction=asc', function(pullRequests) {
      printIssues('open pull requests', pullRequests, orgProject, callback);
    });
  }

  var handler = function(msg) {
    var projectWithOrganization = msg.match[1].split('/');
    var organization = projectWithOrganization[projectWithOrganization.length - 2] || defaultGithubOrganization;
    var project = projectWithOrganization[projectWithOrganization.length - 1]

    var orgProject = organization + '/' + project;
    msg.send('Generating project snapshot for ' + orgProject + '...');
    msg.send('https://waffle.io/' + orgProject);
    recentClosedIssuesReport(orgProject, function(closedIssuesMessage) {
      msg.send(closedIssuesMessage);
      inReviewReport(orgProject, function(inReviewMessage) {
        msg.send(inReviewMessage);
        openPullRequests(orgProject, function(pullRequestsMessage) {
          msg.send(pullRequestsMessage);
          inProgressReport(orgProject, function(inProgressMessage) {
            msg.send(inProgressMessage);
            inboxIssues(orgProject, function(inboxMessage) {
              msg.send(inboxMessage);
            });
          });
        });
      });
    });
  };

  robot.respond(/waffle board (\S+)/i, handler);
};
