The scene studio seems preety well designed and created already!
Lets create next mode bside setup and animte named "direct"
this mode would be a nex thing to do after finishing creating sequecnce in animate 
its role is to create sequence from created timelines in creator simmilar to node view like creating blueprints in unreal engine

user should see list of all created timelines on the left panel where previusly the scene hierearchy and workspace view was
there the timeline is there would be a scenario view that would be mainly responsible for rendering node view
on the top of scneario view there would be a bar where user can create a new scenario or chose another one to lod or create
when new scenario is created autmaticly there is a start node and end node - those are the entry end exit point for single scenario
the user can drag and drop a timelines from that left panel view into the created scenarion and it would spawn a node
every timelne node have input and output pip where user can drag and drop that pip to connect a timeline with another timeline
a start and end nodes have only one pip start on the right and end on the left
user then can connect pip to pip creating the connection between them.
The scenario veiwer also have play and stop and reset on that top bar so user can play the sceneraio.
When sceneario is played the preview should start animating given the user created flow from start to end.
Scanrio must have conncetion from start to any timeline node toplay it
Timelines might have more than one output to represent possible branching scenariosthat could happen. To controll flow we will use unity so we dont need any logical gates to controll that flow. User can just slect specific paths to set as active to preview some scenario, To select - left click on conenction, it should become yellow from white/gray to symbolize its active and also unselect any previous one.
When scenario is beeing played please add some viuals what node is beeing run correnly by background fill animation on node and node flashing when switching to next timeline node. Also maybe even some start end end animations on the start end end nodes. 
Start node should be deep green and end deep red
leave the inspecotr panel for stuff we might add in future to edit on specific timeline nods or transitions like some mixing of keys if for example first frame of new timeline has some alpha to set to 1 and we ended las timeline with 0 we might want to add mixing for all hte keys or maybe even specific ones if wanting
