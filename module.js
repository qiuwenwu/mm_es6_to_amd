'use strict'

const { unique } = require('underscore')
const AbstractSyntaxTree = require('abstract-syntax-tree')
const { identifier } = require('pure-utilities/array')
const { flatten } = require('pure-utilities/collection')

class Module extends AbstractSyntaxTree {
  convert () {
    if (this.has('ImportDeclaration')) {
      this.convertCodeWithImportDeclarations()
    } else if (this.has('ExportDefaultDeclaration')) {
      this.convertExportDefaultDeclarationToDefine()
    } else if (this.has('ExportNamedDeclaration')) {
      this.convertExportNamedDeclarationToDefine()
    }
  }

  convertCodeWithImportDeclarations () {
    var pairs = this.getDependencyPairs()
    this.remove({ type: 'ImportDeclaration' })
    this.normalizePairs(pairs)
    if (this.has('ExportDefaultDeclaration')) {
      this.convertExportDefaultDeclarationToReturn()
    } else if (this.has('ExportNamedDeclaration')) {
      this.convertExportNamedDeclarations()
    }
    this.prependUseStrictLiteral()
    this.wrapWithDefineWithArrayExpression(pairs)
  }

  prependUseStrictLiteral () {
    this.prepend({
      type: 'ExpressionStatement',
      expression: {
        type: 'Literal',
        value: 'use strict'
      }
    })
  }

  isSideEffectImportDeclaration (node) {
    return node.source && node.source.type === 'Literal' && node.specifiers.length === 0
  }

  getDependencyPairs () {
    var dependencyToIdentifierMap = {}
    var imports = this.find('ImportDeclaration')
    var ids = unique(imports.map(item => item.name))
    var result = flatten(imports.map(node => {
      if (this.isSideEffectImportDeclaration(node)) {
        return {
          element: node.source.value
        }
      }
      return node.specifiers.map(function (specifier) {
        if (specifier.type === 'ImportDefaultSpecifier' || specifier.type === 'ImportNamespaceSpecifier') {
          return this.getLocalSpecifier(node, specifier)
        }
        if (specifier.type === 'ImportSpecifier') {
          var param
          var value = node.source.value
          if (specifier.imported.name !== specifier.local.name) {
            return this.getLocalSpecifier(node, specifier)
          } else if (dependencyToIdentifierMap.hasOwnProperty(value)) {
            param = dependencyToIdentifierMap[value]
          } else {
            var identifiers = unique(flatten(ids)).concat(Object.values(dependencyToIdentifierMap))
            param = identifier(identifiers)
            dependencyToIdentifierMap[value] = param
          }
          return {
            param,
            element: node.source.value,
            name: specifier.local.name
          }
        }
      }.bind(this))
    }))
    return result
  }

  getLocalSpecifier (node, specifier) {
    return {
      element: node.source.value,
      param: specifier.local.name
    }
  }

  convertExportNamedDeclarations () {
    var declarations = this.find('ExportNamedDeclaration')
    this.convertExportNamedDeclarationToDeclaration()
    this.remove({ type: 'ExportNamedDeclaration' })
    this.append({
      type: 'ReturnStatement',
      argument: this.getObjectExpression(declarations)
    })
  }

  convertExportNamedDeclarationToDeclaration () {
    this.replace({
      enter: function (node) {
        if (node.type === 'ExportNamedDeclaration' && node.declaration) {
          return node.declaration
        }
      }
    })
  }

  convertExportDefaultDeclarationToDefine () {
    this.prependUseStrictLiteral()
    this.convertExportDefaultDeclarationToReturn()
    this.wrap(body => {
      return [this.getDefineWithFunctionExpression(body)]
    })
  }

  getDefineWithFunctionExpression (body) {
    return this.getDefine([this.getFunctionExpression([], body)])
  }

  convertExportDefaultDeclarationToReturn () {
    this.replace({
      enter: node => {
        if (node.type === 'ExportDefaultDeclaration') {
          node.type = 'ReturnStatement'
          node.argument = node.declaration
          return node
        }
      }
    })
  }

  getDefine (nodes) {
    return {
      type: 'ExpressionStatement',
      expression: {
        type: 'CallExpression',
        callee: { type: 'Identifier', name: 'define' },
        arguments: nodes
      }
    }
  }

  convertExportNamedDeclarationToDefine () {
    this.prependUseStrictLiteral()
    this.convertExportNamedDeclarations()
    this.wrap(body => {
      return [this.getDefineWithFunctionExpression(body)]
    })
  }

  getFunctionExpression (params, body) {
    return {
      type: 'FunctionExpression',
      params: params,
      body: {
        type: 'BlockStatement',
        body: body
      }
    }
  }

  getProperty (node, shorthand) {
    return {
      type: 'Property',
      key: node,
      value: node,
      shorthand: shorthand,
      kind: 'init'
    }
  }

  getObjectExpression (declarations) {
    return {
      'type': 'ObjectExpression',
      'properties': this.mapDeclarationsToProperties(declarations)
    }
  }

  mapDeclarationsToProperties (declarations) {
    return flatten(declarations.map(this.mapDeclarationToProperty.bind(this)))
  }

  mapDeclarationToProperty (declaration) {
    if (!declaration.declaration && declaration.specifiers) {
      return declaration.specifiers.map(node => {
        return this.getProperty(node.local, true)
      })
    }
    if (declaration.declaration.type === 'VariableDeclaration') {
      return declaration.declaration.declarations.map(node => {
        return this.getProperty(node.id)
      })
    }
    return this.getProperty(declaration.declaration.id)
  }

  normalizePairs (pairs) {
    let nodes = pairs.filter(pair => !!pair.name)
    let names = nodes.map(node => node.name)
    this.replace({
      leave: (current, parent) => {
        if (current.type === 'Identifier') {
          let index = names.indexOf(current.name)
          if (index !== -1) {
            let pair = nodes[index]
            return this.convertIdentifierToMemberExpression(pair)
          }
        }
        return current
      }
    })
  }

  convertIdentifierToMemberExpression (pair, current) {
    return {
      type: 'MemberExpression',
      object: {
        type: 'Identifier',
        name: pair.param
      },
      property: {
        type: 'Identifier',
        name: pair.name
      }
    }
  }

  getArrayExpression (elements) {
    return { type: 'ArrayExpression', elements: elements }
  }

  wrapWithDefineWithArrayExpression (pairs) {
    pairs = unique(pairs, item => item.element + item.param)
    var elements = pairs.map(pair => pair.element)
      .map(function (element) {
        return { type: 'Literal', value: element }
      })
    var params = pairs.filter(pair => pair.param).map(pair => pair.param)
      .map(function (param) {
        return { type: 'Identifier', name: param }
      })
    this.wrap(body => {
      return [this.getDefine([
        this.getArrayExpression(elements),
        this.getFunctionExpression(params, body)
      ])]
    })
  }
}

module.exports = Module
