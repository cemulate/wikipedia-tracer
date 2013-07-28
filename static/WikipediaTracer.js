var taglist = ['.collapsible',
                 '#coordinates',
                 '.NavHead',
                 '.vcard',
                 '.infobox_v2',
                 '.geography',
                 '.collapsed',
                 '.vertical-navbox',
                 '.ambox',
                 '.thumb',
                 '.metadata',
                 '.biota',
                 '.infobox',
                 '.dablink',
                 '.toc',
                 '.NavContent',
                 '.nowraplinks',
                 '.toccolours',
                 '.navbox-inner',
                 '.right',
                 '.seealso', // "See also" italicized phrases
                 '.further', // "Further information" italicized phrases
                 '.mainarticle',
                 '.mw-editsection',
                 '.mw-stack',
                 '.noprint']

var taglist2 = ['strong',
                'img',
                'sup',
                '.nowrap',
                'i',
                'small',
                '.external',
                '.IPA',
                '.unicode',
                '.extiw',
                '.new']

function WikipediaTracer($http, transition_callback) {

    // Exposed properties

    this.states = ["ready", "busy", "busy-random", "error", "success"]
    
    this.chain = []
    this.seed = ""
    this.state = "ready"
    this.statistics = {
        loopPoint: "",
        lengthToLoop: 0,
        loopLength: 0
    }


    // Internal properties

    this._cur = ""

    this.$http = $http

    this._transition_callback = transition_callback
}

WikipediaTracer.prototype.changeStatus = function (newstatus) {
    this.state = newstatus

    if (this._transition_callback) {
        this._transition_callback.call(null, newstatus)
    }
}

WikipediaTracer.prototype.getRandomPageName = function () {

    this.changeStatus("busy-random")

    var self = this

    var url = 'http://en.wikipedia.org/w/api.php?action=query&list=random&format=json&rnnamespace=0&rnlimit=1&callback=JSON_CALLBACK&indexpageids='
    this.$http.jsonp(url).success(function (data) {
        self.seed = data.query.random[0].title
        self.state = "ready"
    })
}

WikipediaTracer.prototype.linkFromName = function (name) {
    return "http://en.wikipedia.org/wiki/" + name.split(" ").join("_")
}

WikipediaTracer.prototype.cleanPageName = function (name) {
    return name.split('_').join(' ')
}

WikipediaTracer.prototype.begin = function () {
    this.chain.length = 0
    this._cur = this.seed
    this._tryRvSection = null

    this.doTrace()
}

WikipediaTracer.prototype.doTrace = function () {

    this.changeStatus("busy")

    var turl = 'http://en.wikipedia.org/w/api.php?action=query&format=json&redirects=&prop=revisions&rvlimit=1&rvprop=content&callback=JSON_CALLBACK&rvsection='
    if (this._tryRvSection) {
        turl += this._tryRvSection
    } else {
        turl += "0"
    }
    turl += "&rvparse=&titles="
    turl += this._cur

    var self = this

    this.$http.jsonp(turl).success(function (data) {
        if (data.error) {
            self.state = "error"
            return
        }
        var pages = data.query.pages
        var keys = Object.keys(pages)
        if (keys[0] == "-1") {
            self.state = "error" // no such name
            return
        }
        self._text = pages[keys[0]].revisions[0]["*"]


        self.analyzeContent()
    })

}

WikipediaTracer.prototype.searchElement = function (elm) {
    
    // Search a single element for a link

    for (j = 0; j < taglist2.length; j ++) {
        $(elm).find(taglist2[j]).remove()
    }

    var links = []

    var li = 0

    // On each link, piggy back an attribute that tells us its actual unedited index in the content
    $(elm).find('a').each(function (ind) {
        links.push($(this).attr('href'))
        $(this).attr('absolute-link-index', li)
        li += 1
    })

    // Now remove parenthetical expressions and other unallowed exceptions by grabbing the html and doing raw string manipulation on it
    var inner = $(elm).html()
    while (inner.match(/\(.*?\)/g)) {
        inner = inner.replace(/\(.[^\(]*?\)/g, "")
        inner = inner.replace(/\(\)/g, "")
    }

    // Rebuild an element out of the edited text
    elm = $("<p>").append(inner)

    // Find the *new* first link, and find the actual link that it corresponds to by getting its absolute-link-index and fetching
    // the actual link from our links array

    var firstLinkIndex = $(elm).find('a').first().attr('absolute-link-index')
    if (firstLinkIndex != null) {
        
        // SUCCESS!

        // Now start building a chain Link and return it to the caller

        var actualLink = links[firstLinkIndex]
        var nextSeed = actualLink.substr(6)

        var cont = true

        var chainAppend = {
            seed: nextSeed,
            name: this.cleanPageName(nextSeed),
            link: this.linkFromName(nextSeed),
            loop: false
        }

        return chainAppend

    } else {

        return null
    }

    return null
}

WikipediaTracer.prototype.compareAndContinue = function (chainLink) {
    
    this._tryRvSection = null

    cont = true

    // Detect if we have looped

    i = 0
    for (i = 0; i < this.chain.length; i ++) {
        if (this.chain[i].link == chainLink.link) {
            cont = false
            this.chain[i].loop = true
            this.statistics.loopPoint = this.chain[i].name
            this.statistics.lengthToLoop = i + 1
            this.statistics.loopLength = this.chain.length - (i + 1)
        }
    }

    if (this._add_callback) {
        this._add_callback.call(null)
    }

    // Continue or not

    if (cont) {
        this.chain.push(chainLink)

        this._cur = chainLink.seed
        this.doTrace()
        return
    } else {

        this.changeStatus("success")
        return
    }
}

WikipediaTracer.prototype.analyzeContent = function () {

    if (this._text.length == 0) {

        // This article doesn't have an introduction. Nope out, and this time set the
        // _tryRvSection variable. doTrace will detect it and try a higher section number

        if (!this._tryRvSection) {
            this._tryRvSection = 1
        } else {
            this._tryRvSection += 1
        }
        this.doTrace()
        return
    }

    // Make a jquery object out of the retrieved content
    var doc = $("<html>").html(this._text)

    var i = 0
    var j = 0

    // Remove useless classes
    for (i = 0; i < taglist.length; i ++) {
        $(doc).find(taglist[i]).remove()
    }

    // Get the <p> and <ul> elements, they will contain the first link
    var pchild = $(doc).find("p,ul")

    
    // Search each element for a link. If we find one, go ahead and send the proposed chain element to compare/continue

    var cl = function (_this) {
        // Closure for the ability to 'return' 
        
        var ret = null

        for (i = 0; i < pchild.length; i ++) {
            ret = _this.searchElement(pchild[i])
            if (ret) {
                return ret
            }
        }

        // If that didn't work... try table data tags...

        pchild = $(doc).find("td")

        for (i = 0; i < pchild.length; i ++) {
            ret = _this.searchElement(pchild[i])
            if (ret) {
                return ret
            }
        }

        return null
    }(this)



    if (cl) {
        this.compareAndContinue(cl)
    } else {

        // If we get here, that means all else failed. Up the rvSection

        if (!this._tryRvSection) {
            this._tryRvSection = 1
        } else {
            this._tryRvSection += 1
        }
        this.doTrace()
        return
    }

}