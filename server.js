// 
// Simutrans Listing Server
// 
// 
// Copyright © 2011-2014 Timothy Baldock. All Rights Reserved.
// 
// Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
// 
// 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
// 
// 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
// 
// 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission from the author.
// 
// THIS SOFTWARE IS PROVIDED BY THE AUTHOR "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
// 

// Configured by environment parameters
var header_image      = process.env.HEADER_IMAGE || "simlogo.png";
var port              = process.env.PORT || 8088;

// 1800 = 30 min ; 3600 = 1 hour ; 86400 = 1 day
var prune_interval    = process.env.PRUNE_INTERVAL || 1800; //604800;

// Includes
var express    = require('express');
var fs         = require("fs");
var mustache   = require('mustache');
var validator = require("validator");
var listing    = require('./lib/Listing.js');
var simutil    = require('./lib/SimUtil.js');
var translator = require('./lib/Translator.js');
//var ListingProvider = require('./lib/MongoDBListingProvider.js').ListingProvider;
var ListingProvider = require('./lib/MemoryListingProvider.js').ListingProvider;

var app = express();

// print to console
// 0 = print status/error message 
// 1 = print minor data
// 2 = print error message
// 3 = full data
global.console_log = 3;

app.use(express.bodyParser());
app.set('trust proxy', true);

var translate = (new translator.Translator()).translate;
var available_formats  = ["html", "csv"];
var templatefiles = [
    "header.html",
    "footer.html",
    "announce.html",
    "list.html"
];
var templates = {};

for (n in templatefiles) {
    if (templatefiles.hasOwnProperty(n)) {
        console.log("loading file: " + templatefiles[n] + "...");
        templates[templatefiles[n]] = fs.readFileSync("templates/" + templatefiles[n], "utf8");
    }
}

var listingProvider = new ListingProvider(function () {
    app.listen(port);
    console.log('Listening on port ' + port);
});

app.use('/static', express.static(__dirname + '/public'));

app.get('/', function(req, res) { res.redirect(301, '/list'); });

app.get('/announce', function(req, res) {
    res.writeHead(405, {"Content-Type": "text/html", "Allow": "POST"});
    res.write(mustache.to_html(templates["announce.html"], {}));
    res.end();
});

app.post('/announce', function(req, res) {
    //if (req.ip === '178.77.102.239') { res.send(403, ""); return; }

    if (!req.body.port) {
        res.send(400, "Bad Request - port field missing");
        return;
    }
    if (!listing.validate_port(listing.parse_port(req.body.port))) {
        res.send(400, "Bad Request - port field invalid");
        return;
    }
    if (!req.body.dns) {
        res.send(400, "Bad Request - DNS field missing");
        return;
    }

    if (!req.body.sid) {    // not set unique server id then server name or dns
        req.body.sid = req.body.name+ ":" + req.body.port; //req.body.dns + ":" + req.body.port;
    } 

    listing.validate_dns(listing.parse_dns(req.body.dns), listing.parse_dns(req.body.alt_dns), req.ip,
        function () {
            var new_listing = new listing.Listing(req.body.dns, req.body.port, req.body.sid);
            
            if (global.console_log === 3) {
                console.log("announce item: " + JSON.stringify(req.body));
                console.log("");
            }
            
            if (new_listing.name === "") { new_listing.name = new_listing.id; }

            if (new_listing.sid === "" || new_listing.sid === "undefined") { new_listing.sid = req.body.sid; }
            
            // simutrans version remove \" 
            while (req.body.ver.indexOf("\"") !== -1) {
                req.body.ver = req.body.ver.replace("\"", "");
            }
            // simutrans version repleace ' . ' to '.'
            while (req.body.ver.indexOf(" . ") !== -1) {
                req.body.ver = req.body.ver.replace(" . ", ".");
            }

            if (global.console_log === 1 || global.console_log === 3) {
                console.log("announce sid: " + new_listing.sid);
                console.log("");
            }

            listingProvider.findBySid(new_listing.sid, function (existing_listing) {
                new_listing.update_from_object(existing_listing);
                new_listing.update_from_body(req.body);

                listingProvider.save(new_listing, function () {});
                res.send(201, JSON.stringify(new_listing));
            });
            

        },
            function () {
               res.send(400, "Bad Request - DNS field invalid");
            }
    );
});

app.get('/list', function(req, res) {
    var urlbase, key;

   
    // Process defaults
    if (!req.query.format) { req.query.format = "html"; }

    if (req.query.format === "html") {
    
        var browser_langs = req.headers["accept-language"]; // browser accepts languages
        global.lang = "en"; // default language
        var langs = [ "en", "de", "ja" ]; // exists translate language
    
        if (req.query.lang) {
            var b_lang = [ req.query.lang ]; // user select language
        } else {
            var b_lang = browser_langs.split(","); // browser languages
        }

        // read language name file
        const fs = require('fs');
        let data = fs.readFileSync('./locales/languages.json');
        var langnames = JSON.parse(data, 
            (key, value) => {
                return value;
            }
        );

        langs.forEach( function  (value) { // check select language in exists languages
            if (value === b_lang[0]) {
                global.lang = value;
                return;
            }
        });
        //global.lang = "ja"; // for test translate
        
        // language list header and footer
        var langnames_groups = {};
        var langlist_mapped = [];
        let key;
        for (key in langnames.langlist) {
            if (global.console_log === 3) { 
                console.log("lang id: " + langnames.langlist[key].id);
                console.log ("lang en: " + langnames.langlist[key].namen[0].en_lang);
                console.log ("lang language: " + langnames.langlist[key].namen[0].lang_lang);
                console.log ("");
            }
            
            langnames_groups[langnames.langlist[key].id] = [];

            langnames_groups[langnames.langlist[key].id].push({
                lang_id: langnames.langlist[key].id,
                en_name: langnames.langlist[key].namen[0].en_lang,
                lang_name: langnames.langlist[key].namen[0].lang_lang
            });
            
        }
        // Map langnames into output format for mustache
        for (key in langnames_groups) {
            langlist_mapped.push({name: key, items: langnames_groups[key]});
        }
        
        res.writeHead(200, {"Content-Type": "text/html"});

        // Write header
        res.write(mustache.to_html(templates["header.html"],
            {title: req.host, translate: translate, headerimage: header_image, 
                langlist: langlist_mapped, u_lang: global.lang}));

        urlbase = "./list?lang=" + global.lang;
        if (req.query.detail) {
            urlbase = urlbase + "?lang=" + global.lang + "&detail=" + req.query.detail;
        }

        listingProvider.findAll(function (listings) {
            var pakset_names = [];
            var pakset_groups = {};
            for (key in listings) {
                if (listings.hasOwnProperty(key)) {
                    var item = listings[key];
                    item.u_lang = global.lang;
                    var timings = simutil.get_times(item.date, item.aiv);
                    
                    if (global.console_log === 3) {
                        console.log("listings item: " + JSON.stringify(item));
                        console.log("");
                    }

                    if (timings.overdue_by > prune_interval * 1000) {
                        listingProvider.removeBySid(item.sid, function(removed) {
                            console.log("Pruned stale server with id: " + removed.sid);
                        });
                    } else {
                        if (timings.overdue_by > item.aiv * 1000) {
                            item.st = 0;
                        }
                        
                        var pakname_lower = item.pak.toLowerCase();
                        var start_pakname = pakname_lower.indexOf('pak');
                        var end_pakname = pakname_lower.indexOf(' ', start_pakname);
                        var pakset_name = item.pak.slice(start_pakname, end_pakname);
                        
                        if (pakset_names.indexOf(pakset_name) < 0) {
                            pakset_names.push(pakset_name);
                            pakset_groups[pakset_name] = [];
                        }
                        pakset_groups[pakset_name].push({
                            detail: (key === req.query.detail),
                            data: item,
                            timing: timings
                        });
                    }
                }
            }

            // Map paksets into output format for mustache
            var paksets_mapped = [];
            for (key in pakset_groups) {
                paksets_mapped.push({name: key, items: pakset_groups[key]});
            }

            res.write(mustache.to_html(templates["list.html"],
                {translate: translate, timeformat: simutil.format_time,
                 paksets: paksets_mapped}));

            res.write(mustache.to_html(templates["footer.html"], {langlist: langlist_mapped}));
            res.end();
        });
    } else if (req.query.format === "csv") {
        var response = "";

        listingProvider.findAll(function (listings) {
            for (key in listings) {
                if (listings.hasOwnProperty(key)) {
                    var item = listings[key];
                    var timings = simutil.get_times(item.date, item.aiv);
                    if (timings.overdue_by > prune_interval * 1000) {
                        listingProvider.removeBySid(item.sid, function(removed) {
                            console.log("Pruned stale server with id: " + removed.sid);
                        });
                    } else {
                        if (timings.overdue_by > item.aiv * 1000) {
                            item.st = 0;
                        }
                        if (item.dns
                            && item.port
//                            && item.name 
//                            && item.rev
//                            && item.pak && item.pak !== "unknown") {
                            ) {
                            var itname = "simutrans server";
                            if (item.name) {
                                itname = item.name;
                            }

                            // we return an alternative IP6 only for IP6 capable systems
                            var dns_name = item.dns;
                            if (!req.ip.match(/::ffff:/) )  {
                                // we have a real IP6 here, IPv4 start with "::ffff:" on a dualstack system
                                // thus we return and IP
                                if( validator.isIP(item.alt_dns,"6") ) {
                                   dns_name = "["+item.alt_dns+"]";
                                }
                                else if( validator.isIP(item.dns,"6") ) {
                                   dns_name = "["+item.dns+"]";
                                }
                            }

                            response = response
                                + simutil.csv_escape(itname)
                                + "," + simutil.csv_escape(dns_name
                                + ":" + item.port)
                                + "," + simutil.csv_escape(item.rev.toString())
                                + "," + simutil.csv_escape(item.pak)
                                + "," + simutil.csv_escape(item.st.toString()) + "\n";
                        }
                    }
                }
            }
            res.send(200, response);
        });
    } else {
        res.send(501, "501 Not Implemented - The specified output format is not supported, supported formats are: " + available_formats.toString());
    }
});

